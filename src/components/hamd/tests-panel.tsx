'use client'

/**
 * Tests panel — runs the two mandatory Phase 0 security tests against
 * the LIVE backend (not a mock) and shows structured pass/fail results.
 *
 * Test 1 — Tenant isolation: attempts to read/update/create-with another
 *   tenant's account ID. All three must be blocked.
 * Test 2 — Journal balance: an unbalanced entry must be rejected; a
 *   balanced entry must succeed.
 */
import { useState } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Loader2, ShieldCheck, ShieldAlert, PlayCircle, CheckCircle2, XCircle } from 'lucide-react'
import { toast } from 'sonner'

interface TestDetail {
  name: string
  passed: boolean
  details: Record<string, unknown>
}

export function TestsPanel() {
  const { t } = useI18n()
  const [running, setRunning] = useState(false)
  const [results, setResults] = useState<TestDetail[] | null>(null)
  const [allPassed, setAllPassed] = useState<boolean | null>(null)

  async function runTests() {
    setRunning(true)
    setResults(null)
    setAllPassed(null)
    try {
      const r = await fetch('/api/tests', { method: 'POST' })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      setResults(d.results)
      setAllPassed(d.allPassed)
      if (d.allPassed) toast.success(t('tests.passed'))
      else toast.error(t('tests.failed'))
    } catch {
      toast.error(t('common.error'))
    } finally {
      setRunning(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('tests.title')}</h1>
            <p className="text-xs text-muted-foreground">
              {results ? `${results.length} tests` : t('tests.idle')}
            </p>
          </div>
        </div>
        <Button onClick={runTests} disabled={running} className="gap-2">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <PlayCircle className="h-4 w-4" />}
          <span>{running ? t('tests.running') : t('tests.run')}</span>
        </Button>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base flex items-center gap-2">
            {allPassed === true && <CheckCircle2 className="h-5 w-5 text-success" />}
            {allPassed === false && <ShieldAlert className="h-5 w-5 text-danger" />}
            {t('tests.title')}
          </CardTitle>
          <CardDescription>
            {allPassed === true && t('tests.passed')}
            {allPassed === false && t('tests.failed')}
            {allPassed === null && t('tests.idle')}
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {results?.map((test) => (
            <div key={test.name} className="rounded-md border border-border p-3">
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  {test.passed ? (
                    <CheckCircle2 className="h-4 w-4 text-success" />
                  ) : (
                    <XCircle className="h-4 w-4 text-danger" />
                  )}
                  <span className="font-medium text-sm">
                    {test.name === 'tenant-isolation' ? t('tests.tenantIsolation') : t('tests.journalBalance')}
                  </span>
                </div>
                <span className={`text-xs font-mono ${test.passed ? 'text-success' : 'text-danger'}`}>
                  {test.passed ? t('tests.passed') : t('tests.failed')}
                </span>
              </div>
              <pre className="text-xs bg-muted/50 rounded p-2 overflow-x-auto hamd-scroll font-mono text-muted-foreground">
                {JSON.stringify(test.details, null, 2)}
              </pre>
            </div>
          ))}

          {!results && !running && (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('tests.idle')}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
