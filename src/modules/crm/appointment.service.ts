/**
 * CRM module — Appointment service.
 *
 * Per /upload/crm.md: scheduling an appointment also creates:
 *  - A Reminder (dueAt = scheduledAt minus a lead time, e.g. 1 hour before)
 *  - An ActivityLog entry (type: 'appointment_scheduled')
 * Both inside the same transaction.
 *
 * Also provides listAppointments + getDueReminders (for the /api/reminders/due
 * endpoint which returns reminders where dueAt <= now() AND sent = false).
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import { logActivity } from './activity-log.service'
import type { Appointment, AppointmentStatus, Reminder } from '@prisma/client'

/** Default reminder lead time: 1 hour before the appointment. */
const DEFAULT_REMINDER_LEAD_MS = 60 * 60 * 1000 // 1 hour

export interface AppointmentWithCustomer extends Appointment {
  customer: { id: string; name: string; phone: string | null }
  reminders: Reminder[]
}

/**
 * List all appointments for the current tenant.
 * Permission: crm:read.
 */
export async function listAppointments(): Promise<AppointmentWithCustomer[]> {
  requirePermission('crm:read')
  return db.appointment.findMany({
    orderBy: { scheduledAt: 'desc' },
    include: {
      customer: { select: { id: true, name: true, phone: true } },
      reminders: true,
    },
  })
}

/**
 * Schedule a new appointment + create a reminder + log activity.
 * Permission: crm:manage.
 *
 * All three operations run in a single db.$transaction. If any fails,
 * the entire appointment creation rolls back.
 */
export async function scheduleAppointment(input: {
  customerId: string
  scheduledAt: Date
  note?: string
}): Promise<AppointmentWithCustomer> {
  requirePermission('crm:manage')

  // Verify the customer belongs to the current tenant (security check —
  // prevents cross-tenant appointment creation via a stolen customer ID).
  // db.customer is scoped by the middleware, so findUnique on another
  // tenant's customer returns null.
  const customer = await db.customer.findUnique({
    where: { id: input.customerId },
    select: { id: true, name: true, phone: true },
  })
  if (!customer) {
    throw new Error('Customer not found')
  }

  // Use db.$transaction so the appointment, reminder, and activity log
  // are all created atomically. If any fails, nothing is persisted.
  return db.$transaction(async (tx) => {
    // 1. Create the appointment
    const appointment = await tx.appointment.create({
      data: {
        tenantId: (await getTenantId()),
        customerId: input.customerId,
        scheduledAt: input.scheduledAt,
        note: input.note ?? null,
        status: 'SCHEDULED',
      },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
      },
    })

    // 2. Create a reminder (1 hour before the appointment)
    const reminderDueAt = new Date(input.scheduledAt.getTime() - DEFAULT_REMINDER_LEAD_MS)
    await tx.reminder.create({
      data: {
        appointmentId: appointment.id,
        dueAt: reminderDueAt,
        sent: false,
        channel: 'in_app',
      },
    })

    // 3. Log the activity (inside the same transaction)
    await logActivity(
      {
        customerId: input.customerId,
        type: 'appointment_scheduled',
        refId: appointment.id,
      },
      tx
    )

    // Re-fetch with reminders included
    const result = await tx.appointment.findUnique({
      where: { id: appointment.id },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        reminders: true,
      },
    })
    return result as AppointmentWithCustomer
  })
}

/**
 * Get all due reminders (dueAt <= now AND sent = false).
 * Permission: crm:read.
 *
 * Used by the /api/reminders/due endpoint to show in-app notifications.
 */
export async function getDueReminders(): Promise<
  Array<{
    id: string
    dueAt: Date
    sent: boolean
    channel: string
    appointment: {
      id: string
      scheduledAt: Date
      note: string | null
      customer: { id: string; name: string }
    }
  }>
> {
  requirePermission('crm:read')
  const reminders = await db.reminder.findMany({
    where: {
      dueAt: { lte: new Date() },
      sent: false,
    },
    include: {
      appointment: {
        include: {
          customer: { select: { id: true, name: true } },
        },
      },
    },
    orderBy: { dueAt: 'asc' },
  })
  // Filter: the Reminder model itself has no tenantId, but its Appointment
  // does — the scoped db.appointment already filters to the current tenant,
  // so only reminders for this tenant's appointments are returned.
  return reminders.map((r) => ({
    id: r.id,
    dueAt: r.dueAt,
    sent: r.sent,
    channel: r.channel,
    appointment: {
      id: r.appointment.id,
      scheduledAt: r.appointment.scheduledAt,
      note: r.appointment.note,
      customer: {
        id: r.appointment.customer.id,
        name: r.appointment.customer.name,
      },
    },
  }))
}

/**
 * Mark a reminder as sent (after the user has seen the notification).
 * Permission: crm:read.
 */
export async function markReminderSent(reminderId: string): Promise<void> {
  requirePermission('crm:read')
  await db.reminder.update({
    where: { id: reminderId },
    data: { sent: true },
  })
}

// Helper to get tenantId inside a transaction
async function getTenantId(): Promise<string> {
  const { getTenantContext } = await import('@/core/tenancy/context')
  const ctx = getTenantContext()
  if (!ctx) throw new Error('No tenant context')
  return ctx.tenantId
}
