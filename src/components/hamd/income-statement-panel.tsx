'use client'

/**
 * Income Statement panel — Revenue vs Expenses, computed from the ledger.
 *
 * Per /upload/accounting.md: "تقرير قائمة دخل مبسّط يُحسب من JournalLine
 * مباشرة (SUM حسب AccountType)، لا جدول منفصل".
 */
import { useState } from 'react'
import { useI18n, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Badge } from '@/components/ui/badge'
import { Loader2, BarChart3, TrendingUp, TrendingDown, Calculator } from 'lucide-react'
import { toast } from 'sonner'

interface IncomeStatementAccount {
  id: string
  code: string
  nameKey: string
  balance: number
}
interface IncomeStatement {
  revenue: { total: number; accounts: IncomeStatementAccount[] }
  expenses: { total: number; accounts: IncomeStatementAccount[] }
  netIncome: number
}

export function IncomeStatementPanel() {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const [report, setReport] = useState<IncomeStatement | null>(null)
  const [loading, setLoading] = useState(false)

  async function load() {
    setLoading(true)
    try {
      const r = await fetch('/api/reports/income-statement', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      setReport(await r.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BarChart3 className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('report.incomeStatement')}</h1>
            <p className="text-xs text-muted-foreground">{t('report.incomeStatement')}</p>
          </div>
        </div>
        <Button onClick={load} disabled={loading} size="sm" className="gap-2">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Calculator className="h-4 w-4" />}
          <span>{loading ? t('common.loading') : t('report.incomeStatement')}</span>
        </Button>
      </div>

      {!report && !loading && (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            {t('report.noData')}
          </CardContent>
        </Card>
      )}

      {report && (
        <div className="space-y-4">
          {/* Net Income Summary Card */}
          <Card className="bg-surface">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {report.netIncome >= 0 ? (
                    <TrendingUp className="h-5 w-5 text-success" />
                  ) : (
                    <TrendingDown className="h-5 w-5 text-danger" />
                  )}
                  <span className="font-medium">{t('report.netIncome')}</span>
                </div>
                <span className={`text-xl font-mono font-bold ${report.netIncome >= 0 ? 'text-success' : 'text-danger'}`}>
                  {formatNumber(report.netIncome, { minimumFractionDigits: 2 })}
                </span>
              </div>
            </CardContent>
          </Card>

          {/* Revenue Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingUp className="h-4 w-4 text-success" />
                {t('report.revenue')}
              </CardTitle>
              <CardDescription>
                {t('report.totalRevenue')}: <span className="font-mono font-medium">{formatNumber(report.revenue.total, { minimumFractionDigits: 2 })}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.revenue.accounts.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">{t('report.noData')}</div>
              ) : (
                <div className="space-y-1">
                  {report.revenue.accounts.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground w-16">{acc.code}</span>
                        <span className="text-sm">{t(acc.nameKey)}</span>
                      </div>
                      <span className="font-mono text-sm text-success">
                        {formatNumber(acc.balance, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-2 border-t border-border font-medium">
                    <span>{t('report.totalRevenue')}</span>
                    <span className="font-mono">{formatNumber(report.revenue.total, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Expenses Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <TrendingDown className="h-4 w-4 text-danger" />
                {t('report.expenses')}
              </CardTitle>
              <CardDescription>
                {t('report.totalExpenses')}: <span className="font-mono font-medium">{formatNumber(report.expenses.total, { minimumFractionDigits: 2 })}</span>
              </CardDescription>
            </CardHeader>
            <CardContent>
              {report.expenses.accounts.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">{t('report.noData')}</div>
              ) : (
                <div className="space-y-1">
                  {report.expenses.accounts.map((acc) => (
                    <div key={acc.id} className="flex items-center justify-between py-1.5 border-b border-border/50 last:border-0">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs text-muted-foreground w-16">{acc.code}</span>
                        <span className="text-sm">{t(acc.nameKey)}</span>
                      </div>
                      <span className="font-mono text-sm text-danger">
                        {formatNumber(acc.balance, { minimumFractionDigits: 2 })}
                      </span>
                    </div>
                  ))}
                  <div className="flex items-center justify-between pt-2 mt-2 border-t border-border font-medium">
                    <span>{t('report.totalExpenses')}</span>
                    <span className="font-mono">{formatNumber(report.expenses.total, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Net Income Card */}
          <Card className={report.netIncome >= 0 ? 'border-success/30' : 'border-danger/30'}>
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <span className="font-medium text-base">{t('report.netIncome')}</span>
                <div className="flex items-center gap-2">
                  <Badge variant="outline" className={report.netIncome >= 0 ? 'bg-success/15 text-success' : 'bg-danger/15 text-danger'}>
                    {report.netIncome >= 0 ? t('report.revenue') : t('report.expenses')}
                  </Badge>
                  <span className={`text-lg font-mono font-bold ${report.netIncome >= 0 ? 'text-success' : 'text-danger'}`}>
                    {formatNumber(report.netIncome, { minimumFractionDigits: 2 })}
                  </span>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  )
}
