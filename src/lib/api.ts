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

export function badRequest(locale: ApiLocale, messageKey: string, issues?: ApiErrorBody['error']['issues']) {
  return NextResponse.json<ApiErrorBody>(
    { error: { code: 'BAD_REQUEST', message: t(messageKey, locale), issues } },
    { status: 400 }
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
 * Map a thrown error from the service layer to an HTTP response.
 * Returns null if the error is not recognized (caller should then
 * return serverError()).
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
  return serverError(locale)
}

/** Thrown by the journal service when SUM(debit) !== SUM(credit). */
export class JournalBalanceError extends Error {
  constructor(public debitSum: string, public creditSum: string) {
    super(`Unbalanced: debit=${debitSum} credit=${creditSum}`)
    this.name = 'JournalBalanceError'
  }
}
