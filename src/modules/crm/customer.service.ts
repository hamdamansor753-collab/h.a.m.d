/**
 * CRM module — Customer service.
 *
 * CRUD for customers. Per /upload/crm.md: customers replace the free-text
 * `customerName` on invoices with an optional structured link.
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import type { Customer } from '@prisma/client'

export interface CustomerWithStats extends Customer {
  _count?: { invoices: number; appointments: number; activities: number }
}

/**
 * List all customers for the current tenant.
 * Permission: crm:read.
 */
export async function listCustomers(): Promise<CustomerWithStats[]> {
  requirePermission('crm:read')
  return db.customer.findMany({
    orderBy: { createdAt: 'desc' },
    include: {
      _count: {
        select: { invoices: true, appointments: true, activities: true },
      },
    },
  })
}

/**
 * Get a single customer by ID (scoped to current tenant).
 * Permission: crm:read.
 */
export async function getCustomer(id: string): Promise<Customer | null> {
  requirePermission('crm:read')
  return db.customer.findUnique({ where: { id } })
}

/**
 * Create a new customer.
 * Permission: crm:manage.
 */
export async function createCustomer(input: {
  name: string
  phone?: string
  email?: string
}): Promise<Customer> {
  requirePermission('crm:manage')
  return db.customer.create({
    data: {
      name: input.name,
      phone: input.phone ?? null,
      email: input.email ?? null,
    },
  })
}
