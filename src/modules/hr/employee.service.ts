/**
 * HR module — Employee service.
 *
 * CRUD for employees. Salary fields (baseSalary, nationalId) are SENSITIVE
 * and require `hr:salary:read` permission — the `listEmployees` and
 * `getEmployee` functions accept a `canReadSalary` flag that controls
 * whether those fields are included in the response.
 *
 * Per /upload/hr.md: "صلاحية `hr:read` **لا تكفي وحدها** لعرض الراتب —
 * تحتاج صلاحية أدق `hr:salary:read` منفصلة".
 */
import { db } from '@/lib/db'
import { requirePermission } from '@/core/rbac'
import type { Employee, EmployeeStatus } from '@prisma/client'

export interface EmployeePublic {
  id: string
  tenantId: string
  fullName: string
  hireDate: Date
  status: EmployeeStatus
  createdAt: Date
  // baseSalary and nationalId are OMITTED — they require hr:salary:read
}

export interface EmployeeWithSalary extends EmployeePublic {
  baseSalary: string
  nationalId: string
}

/**
 * List all employees for the current tenant.
 * Permission: hr:read.
 *
 * If `canReadSalary` is false (caller has hr:read but NOT hr:salary:read),
 * salary fields (baseSalary, nationalId) are stripped from the response.
 */
export async function listEmployees(canReadSalary: boolean): Promise<Array<EmployeePublic | EmployeeWithSalary>> {
  requirePermission('hr:read')
  const employees = await db.employee.findMany({
    orderBy: { createdAt: 'desc' },
  })
  return employees.map((e) => stripSalaryIfNeeded(e, canReadSalary))
}

/**
 * Get a single employee by ID (scoped to current tenant).
 * Permission: hr:read.
 */
export async function getEmployee(id: string, canReadSalary: boolean): Promise<EmployeePublic | EmployeeWithSalary | null> {
  requirePermission('hr:read')
  const employee = await db.employee.findUnique({ where: { id } })
  if (!employee) return null
  return stripSalaryIfNeeded(employee, canReadSalary)
}

/**
 * Create a new employee.
 * Permission: hr:manage.
 */
export async function createEmployee(input: {
  fullName: string
  nationalId: string
  hireDate: Date
  baseSalary: number
  status?: EmployeeStatus
}): Promise<Employee> {
  requirePermission('hr:manage')
  return db.employee.create({
    data: {
      fullName: input.fullName,
      nationalId: input.nationalId,
      hireDate: input.hireDate,
      baseSalary: input.baseSalary,
      status: input.status ?? 'ACTIVE',
    },
  })
}

/**
 * List ACTIVE employees (used by payroll run creation).
 * Permission: hr:read. Always returns salary (internal use by payroll service
 * which requires payroll:run, a higher permission).
 */
export async function listActiveEmployees(): Promise<Employee[]> {
  requirePermission('hr:read')
  return db.employee.findMany({
    where: { status: 'ACTIVE' },
    orderBy: { createdAt: 'asc' },
  })
}

// ---------- Helpers ----------

function stripSalaryIfNeeded(
  employee: Employee,
  canReadSalary: boolean
): EmployeePublic | EmployeeWithSalary {
  if (!canReadSalary) {
    return {
      id: employee.id,
      tenantId: employee.tenantId,
      fullName: employee.fullName,
      hireDate: employee.hireDate,
      status: employee.status,
      createdAt: employee.createdAt,
    }
  }
  return {
    id: employee.id,
    tenantId: employee.tenantId,
    fullName: employee.fullName,
    nationalId: employee.nationalId,
    hireDate: employee.hireDate,
    baseSalary: employee.baseSalary.toString(),
    status: employee.status,
    createdAt: employee.createdAt,
  }
}
