/**
 * Helpers for API routes: consistent JSON responses and error mapping.
 *
 * Per /upload/05-security-baseline.md section 6:
 *  - Error messages shown to the user are translated via i18n keys, never
 *    leak internal details (stack traces, table names).
 *  - Zod errors are read via `.issues` (not `.errors`).
 */
import { NextResponse } from 'next/server'
import { ZodError } from 'zod'
import { RbacError } from '@/core/rbac'
import { TenantContextError } from '@/core/tenancy/context'
import { t } from '@/core/i18n'

export type ApiLocale = string

export interface ApiErrorBody {
  error: {
    code: string
    message: string
    // Zod field issues, when applicable. Field paths use the i18n key
    // `validation.<path>` so the client can translate them.
    issues?: Array<{ path: string; message: string }>
  }
}

export function ok<T>(data: T, status = 200) {
  return NextResponse.json(data, { status })
}

export function unauthorized(locale: ApiLocale = 'en') {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'UNAUTHORIZED', message: t('common.unauthorized', locale) } },
    { status: 401 }
  )
}

export function forbidden(locale: ApiLocale = 'en') {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'FORBIDDEN', message: t('common.forbidden', locale) } },
    { status: 403 }
  )
}

export function notFound(locale: ApiLocale, messageKey = 'common.error') {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'NOT_FOUND', message: t(messageKey, locale) } },
    { status: 404 }
  )
}

export function badRequest(locale: ApiLocale, messageKey: string, issues?: ApiErrorBody['error']['issues']) {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'BAD_REQUEST', message: t(messageKey, locale), issues } },
    { status: 400 }
  )
}

export function conflict(locale: ApiLocale, messageKey: string) {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'CONFLICT', message: t(messageKey, locale) } },
    { status: 409 }
  )
}

export function serverError(locale: ApiLocale = 'en') {
  // Never leak the actual error to the client. Log server-side, return
  // a generic translated message.
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'INTERNAL', message: t('common.error', locale) } },
    { status: 500 }
  )
}

/**
 * Thrown by the journal service when SUM(debit) !== SUM(credit).
 */
export class JournalBalanceError extends Error {
  constructor(public debitSum: string, public creditSum: string) {
    super(`Unbalanced: debit=${debitSum} credit=${creditSum}`)
    this.name = 'JournalBalanceError'
  }
}

/**
 * Thrown by the invoice service when an operation is attempted on an
 * invoice in the wrong state (e.g. editing a POSTED invoice).
 */
export class InvoiceStateError extends Error {
  constructor(public code: 'NOT_DRAFT' | 'NOT_POSTED' | 'ALREADY_VOID', message: string) {
    super(message)
    this.name = 'InvoiceStateError'
  }
}

/**
 * Thrown by the invoice service when required posting accounts are missing.
 */
export class InvoiceConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'InvoiceConfigError'
  }
}

/**
 * Map a thrown error from the service layer to an HTTP response.
 */
export function mapError(err: unknown, locale: ApiLocale): NextResponse {
  if (err instanceof RbacError) {
    if (err.code === 'NO_CONTEXT') return unauthorized(locale)
    return forbidden(locale)
  }
  if (err instanceof TenantContextError) {
    return unauthorized(locale)
  }
  if (err instanceof ZodError) {
    const issues = (err as ZodError).issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
    }))
    return badRequest(locale, 'common.error', issues)
  }
  if (err instanceof JournalBalanceError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: 'UNBALANCED', message: t('journal.unbalanced', locale) } },
      { status: 400 }
    )
  }
  if (err instanceof InvoiceStateError) {
    // NOT_DRAFT / NOT_POSTED / ALREADY_VOID → 409 Conflict (state mismatch)
    return conflict(locale, 'invoice.cannotModify')
  }
  if (err instanceof InvoiceConfigError) {
    return NextResponse.json<ApiErrorBody>(
      { error: { code: 'INVOICE_CONFIG', message: t('invoice.configError', locale) } },
      { status: 500 }
    )
  }
  return serverError(locale)
}
