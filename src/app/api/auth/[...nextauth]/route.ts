/**
 * NextAuth route handler. Delegates to the shared authOptions.
 * runtime = 'nodejs' is MANDATORY (per /upload/05-security-baseline.md
 * section 2) because the handler uses Prisma via the credentials provider.
 */
import NextAuth from 'next-auth'
import { authOptions } from '@/core/auth/options'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const handler = NextAuth(authOptions)
export { handler as GET, handler as POST }
