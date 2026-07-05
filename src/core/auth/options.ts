/**
 * NextAuth configuration — Credentials provider, JWT sessions.
 *
 * Design:
 *  - Passwords verified against `User.passwordHash` (bcrypt).
 *  - JWT carries { sub, tenantId, email, name, locale, roleKeys, permissionKeys }.
 *  - On every authenticated request, the route handler reads the JWT,
 *    builds a TenantContextValue, and runs the request inside
 *    `runInTenantContext(...)` so the Prisma middleware enforces scoping.
 *
 * Per /upload/05-security-baseline.md:
 *  - Passwords hashed with bcrypt (no reversible encryption).
 *  - No sensitive data in error messages returned to the client.
 */
import type { NextAuthOptions } from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'
import bcrypt from 'bcryptjs'
import { dbRaw } from '@/lib/db'
import { loadTranslations } from '@/core/i18n'

// Warm the i18n cache on module load so the first request has it ready.
void loadTranslations()

export const authOptions: NextAuthOptions = {
  session: { strategy: 'jwt' },
  pages: {
    // We do not use a dedicated /login page — the single `/` route renders
    // either the login form (unauthenticated) or the dashboard. We still
    // set signIn so NextAuth's internal redirects know where to go.
    signIn: '/',
  },
  providers: [
    CredentialsProvider({
      name: 'credentials',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(creds) {
        if (!creds?.email || !creds?.password) return null

        // Auth lookup is cross-tenant by email — but email is unique only
        // within a tenant (compound @@unique([tenantId, email])). For the
        // Phase 0 demo we find the first user with this email; production
        // would require an explicit tenant selector on the login screen.
        //
        // We use `dbRaw` (the raw client without tenant middleware) because
        // this lookup MUST be cross-tenant and runs BEFORE any tenant
        // context exists (the user isn't logged in yet). This is one of
        // the three auditable uses of dbRaw: auth, seed, tests.
        const user = await dbRaw.user.findFirst({
          where: { email: creds.email.toLowerCase() },
          include: {
            roles: { include: { role: { include: { permissions: true } } } },
          },
        })
        if (!user) return null

        const ok = await bcrypt.compare(creds.password, user.passwordHash)
        if (!ok) return null

        const roleKeys = user.roles.map((ur) => ur.role.name)
        const permissionKeys = Array.from(
          new Set(user.roles.flatMap((ur) => ur.role.permissions.map((p) => p.key)))
        )

        return {
          id: user.id,
          tenantId: user.tenantId,
          email: user.email,
          name: user.name,
          locale: user.locale,
          roleKeys,
          permissionKeys,
        } as unknown as { id: string } & Record<string, unknown>
      },
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        const u = user as unknown as {
          id: string
          tenantId: string
          locale: string
          roleKeys: string[]
          permissionKeys: string[]
        }
        token.tenantId = u.tenantId
        token.locale = u.locale
        token.roleKeys = u.roleKeys
        token.permissionKeys = u.permissionKeys
      }
      return token
    },
    async session({ session, token }) {
      // Expose tenant info on session.user for client consumption.
      if (session.user) {
        ;(session.user as Record<string, unknown>).id = token.sub
        ;(session.user as Record<string, unknown>).tenantId = token.tenantId
        ;(session.user as Record<string, unknown>).locale = token.locale
        ;(session.user as Record<string, unknown>).roleKeys = token.roleKeys
        ;(session.user as Record<string, unknown>).permissionKeys = token.permissionKeys
      }
      return session
    },
  },
  secret: process.env.NEXTAUTH_SECRET ?? 'hamd-dev-secret-change-in-production',
}

// Augment NextAuth types — the JWT and session carry tenant/role info.
declare module 'next-auth' {
  interface Session {
    user: {
      id: string
      tenantId: string
      email: string
      name: string
      locale: string
      roleKeys: string[]
      permissionKeys: string[]
    }
  }
}

declare module 'next-auth/jwt' {
  interface JWT {
    tenantId: string
    locale: string
    roleKeys: string[]
    permissionKeys: string[]
  }
}
