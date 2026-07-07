/**
 * CRM module — service layer.
 *
 * Implements the customer / appointment / reminder / activity-log domain.
 *
 * Functions:
 *  - listCustomers()         — crm:read — customers with appointment + activity counts
 *  - createCustomer(input)   — crm:manage — create a customer
 *  - listAppointments()      — crm:read — appointments with their customer, newest first
 *  - createAppointment(...)  — crm:manage — atomic: Appointment + Reminder + ActivityLog
 *  - updateAppointmentStatus(id, status) — crm:manage — atomic: status update + ActivityLog
 *  - listActivityLog(customerId?)         — crm:read — optional customer filter
 *
 * Per the Phase 1 hard rule: every operation inside db.$transaction() MUST
 * include tenantId explicitly in where/data — the tx client has no tenant
 * middleware. See purchase-order.service.ts for the same convention.
 *
 * Per /upload/05-security-baseline.md section 3: permission checks happen
 * in the SERVICE LAYER, not just the UI. No direct Prisma access from routes.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { getTenantContext } from '@/core/tenancy/context'
import type {
  Customer,
  Appointment,
  ActivityLog,
  AppointmentStatus,
} from '@prisma/client'

// ---------- Constants ----------

// The reminder fires 1 hour before the appointment's scheduled time.
const REMINDER_LEAD_MS = 60 * 60 * 1000
// Channel for the auto-created reminder. 'in_app' = show inside the ERP UI;
// other channels (sms, email, whatsapp) can be wired up by a notifier later.
const REMINDER_CHANNEL = 'in_app'

// ActivityLog type strings (kept as string literals so the schema stays
// enum-free — easy to extend without a migration).
const ACTIVITY_APPOINTMENT_CREATED = 'appointment_created'
const ACTIVITY_APPOINTMENT_STATUS_CHANGED = 'appointment_status_changed'

// ---------- Types ----------

export interface CustomerWithCounts extends Customer {
  _count: { appointments: number; activityLogs: number }
}

export interface AppointmentWithCustomer extends Appointment {
  customer: Customer
}

export interface ActivityLogWithCustomer extends ActivityLog {
  customer: Customer
}

// ---------- Customers ----------

/**
 * List all customers for the current tenant, alphabetical by name, each with
 * a count of appointments and activity-log entries.
 *
 * Permission: crm:read.
 */
export async function listCustomers(): Promise<CustomerWithCounts[]> {
  requirePermission('crm:read')
  return db.customer.findMany({
    orderBy: { name: 'asc' },
    include: {
      _count: { select: { appointments: true, activityLogs: true } },
    },
  })
}

/**
 * Create a new customer in the current tenant.
 *
 * Permission: crm:manage.
 */
export async function createCustomer(input: {
  name: string
  phone?: string | null
  email?: string | null
}): Promise<Customer> {
  requirePermission('crm:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  const name = input.name?.trim()
  if (!name) {
    throw new Error('Customer name is required')
  }

  return db.customer.create({
    data: {
      tenantId: ctx.tenantId, // explicit — middleware would set it too, but be safe
      name,
      phone: input.phone?.trim() || null,
      email: input.email?.trim() || null,
    },
  })
}

// ---------- Appointments ----------

/**
 * List all appointments for the current tenant with their customer, newest
 * scheduledAt first.
 *
 * Permission: crm:read.
 */
export async function listAppointments(): Promise<AppointmentWithCustomer[]> {
  requirePermission('crm:read')
  return db.appointment.findMany({
    include: { customer: true },
    orderBy: { scheduledAt: 'desc' },
  })
}

/**
 * Create a new appointment with status SCHEDULED, plus:
 *  - a Reminder (dueAt = scheduledAt - 1 hour, sent=false, channel='in_app')
 *  - an ActivityLog (type='appointment_created', refId=appointment.id)
 *
 * All three writes run inside a single db.$transaction so the appointment
 * is never visible without its reminder + audit trail.
 *
 * Permission: crm:manage.
 */
export async function createAppointment(input: {
  customerId: string
  scheduledAt: Date
  note?: string | null
}): Promise<AppointmentWithCustomer> {
  requirePermission('crm:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  const scheduledAt = input.scheduledAt
  const reminderDueAt = new Date(scheduledAt.getTime() - REMINDER_LEAD_MS)
  const customerId = input.customerId
  const note = input.note?.trim() || null

  return db.$transaction(async (tx) => {
    // 1. Verify the customer belongs to the current tenant (tx has no
    //    middleware, so include tenantId explicitly).
    const customer = await tx.customer.findFirst({
      where: { id: customerId, tenantId: ctx.tenantId },
      select: { id: true },
    })
    if (!customer) {
      throw new Error('Customer not found')
    }

    // 2. Create the appointment (SCHEDULED is the schema default).
    const appointment = await tx.appointment.create({
      data: {
        tenantId: ctx.tenantId,
        customerId,
        scheduledAt,
        note,
        status: 'SCHEDULED',
      },
      include: { customer: true },
    })

    // 3. Schedule the reminder — 1 hour before, in-app channel.
    await tx.reminder.create({
      data: {
        appointmentId: appointment.id,
        dueAt: reminderDueAt,
        sent: false,
        channel: REMINDER_CHANNEL,
      },
    })

    // 4. Audit: appointment_created.
    await tx.activityLog.create({
      data: {
        tenantId: ctx.tenantId,
        customerId,
        type: ACTIVITY_APPOINTMENT_CREATED,
        refId: appointment.id,
      },
    })

    return appointment
  })
}

/**
 * Update an appointment's status (COMPLETED / CANCELLED / NO_SHOW) and
 * create an ActivityLog entry recording the transition.
 *
 * Permission: crm:manage.
 */
export async function updateAppointmentStatus(
  id: string,
  status: AppointmentStatus
): Promise<AppointmentWithCustomer> {
  requirePermission('crm:manage')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')

  return db.$transaction(async (tx) => {
    // 1. Verify the appointment belongs to the current tenant (explicit
    //    tenantId — tx has no middleware).
    const existing = await tx.appointment.findFirst({
      where: { id, tenantId: ctx.tenantId },
      select: { id: true, customerId: true },
    })
    if (!existing) {
      throw new Error('Appointment not found')
    }

    // 2. Apply the status change.
    const updated = await tx.appointment.update({
      where: { id, tenantId: ctx.tenantId },
      data: { status },
      include: { customer: true },
    })

    // 3. Audit: appointment_status_changed.
    await tx.activityLog.create({
      data: {
        tenantId: ctx.tenantId,
        customerId: existing.customerId,
        type: ACTIVITY_APPOINTMENT_STATUS_CHANGED,
        refId: id,
      },
    })

    return updated
  })
}

// ---------- Activity Log ----------

/**
 * List activity log entries for the current tenant. If customerId is
 * provided, filter by it; otherwise list all.
 *
 * Permission: crm:read.
 */
export async function listActivityLog(
  customerId?: string
): Promise<ActivityLogWithCustomer[]> {
  requirePermission('crm:read')
  const where = customerId ? { customerId } : {}
  return db.activityLog.findMany({
    where,
    include: { customer: true },
    orderBy: { createdAt: 'desc' },
  })
}
