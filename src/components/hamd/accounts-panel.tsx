'use client'

/**
 * Accounts panel — shows the chart of accounts as a tree, and a form to
 * add a new account. All text via i18n. Account names are themselves
 * i18n keys (per the data model — `Account.nameKey`).
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, BookOpen } from 'lucide-react'
import { ChevronEnd, ChevronDown } from '@/components/hamd/icons'
import { toast } from 'sonner'

interface Account {
  id: string
  tenantId: string
  code: string
  nameKey: string
  type: string
  parentId: string | null
  createdAt: string
}
interface AccountNode extends Account {
  children: AccountNode[]
}

interface Props {
  canCreate: boolean
}

const TYPE_COLORS: Record<string, string> = {
  ASSET: 'bg-success/15 text-success border-success/30',
  LIABILITY: 'bg-warning/15 text-warning border-warning/30',
  EQUITY: 'bg-accent/15 text-accent border-accent/30',
  REVENUE: 'bg-primary/15 text-primary border-primary/30',
  EXPENSE: 'bg-danger/15 text-danger border-danger/30',
}

export function AccountsPanel({ canCreate }: Props) {
  const { t } = useI18n()
  const [tree, setTree] = useState<AccountNode[]>([])
  const [flat, setFlat] = useState<Account[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [code, setCode] = useState('')
  const [nameKey, setNameKey] = useState('')
  const [type, setType] = useState('ASSET')
  const [parentId, setParentId] = useState<string>('none')
  const [creating, setCreating] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const r = await fetch('/api/accounts', { cache: 'no-store', credentials: 'include' })
      if (!r.ok) throw new Error()
      const d = await r.json()
      setTree(d.tree)
      setFlat(d.flat)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault()
    setCreating(true)
    try {
      const r = await fetch('/api/accounts', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code,
          nameKey,
          type,
          parentId: parentId === 'none' ? null : parentId,
        }),
      })
      if (!r.ok) {
        const d = await r.json().catch(() => null)
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('account.create'))
      setCode('')
      setNameKey('')
      setType('ASSET')
      setParentId('none')
      setShowForm(false)
      void load()
    } finally {
      setCreating(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <BookOpen className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('nav.accounts')}</h1>
            <p className="text-xs text-muted-foreground">{flat.length} {t('nav.accounts')}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((s) => !s)} variant={canCreate ? 'default' : 'outline'} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('account.create')}</span>
          </Button>
        )}
      </div>

      {showForm && canCreate && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">{t('account.create')}</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreate} className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <Label htmlFor="code">{t('account.code')}</Label>
                <Input id="code" value={code} onChange={(e) => setCode(e.target.value)} placeholder="1000.01" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="nameKey">{t('account.name')} (key)</Label>
                <Input id="nameKey" value={nameKey} onChange={(e) => setNameKey(e.target.value)} placeholder="account.cash" required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">{t('account.type')}</Label>
                <Select value={type} onValueChange={setType}>
                  <SelectTrigger id="type"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="ASSET">{t('type.ASSET')}</SelectItem>
                    <SelectItem value="LIABILITY">{t('type.LIABILITY')}</SelectItem>
                    <SelectItem value="EQUITY">{t('type.EQUITY')}</SelectItem>
                    <SelectItem value="REVENUE">{t('type.REVENUE')}</SelectItem>
                    <SelectItem value="EXPENSE">{t('type.EXPENSE')}</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="parent">Parent</Label>
                <Select value={parentId} onValueChange={setParentId}>
                  <SelectTrigger id="parent"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">—</SelectItem>
                    {flat.map((a) => (
                      <SelectItem key={a.id} value={a.id}>{a.code} · {t(a.nameKey)}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="sm:col-span-2 flex justify-end gap-2 pt-2">
                <Button type="button" variant="outline" onClick={() => setShowForm(false)}>{t('common.cancel')}</Button>
                <Button type="submit" disabled={creating}>
                  {creating && <Loader2 className="h-4 w-4 animate-spin" />}
                  <span className="ms-2">{t('common.save')}</span>
                </Button>
              </div>
            </form>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('nav.accounts')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : tree.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('account.empty')}</div>
          ) : (
            <div className="max-h-[60vh] overflow-auto hamd-scroll">
              <TreeRows nodes={tree} depth={0} />
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )

  function TreeRows({ nodes, depth }: { nodes: AccountNode[]; depth: number }) {
    return (
      <div className="space-y-0.5">
        {nodes.map((node) => (
          <TreeNode key={node.id} node={node} depth={depth} />
        ))}
      </div>
    )
  }

  function TreeNode({ node, depth }: { node: AccountNode; depth: number }) {
    const [open, setOpen] = useState(true)
    const hasChildren = node.children.length > 0
    return (
      <div>
        <div
          className="flex items-center gap-2 py-1.5 px-2 rounded hover:bg-muted/50"
          style={{ paddingInlineStart: `${depth * 20 + 8}px` }}
        >
          {hasChildren ? (
            <button onClick={() => setOpen((o) => !o)} className="text-muted-foreground hover:text-foreground">
              {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronEnd className="h-3.5 w-3.5" />}
            </button>
          ) : (
            <span className="inline-block w-3.5" />
          )}
          <span className="font-mono text-xs text-muted-foreground w-16 shrink-0">{node.code}</span>
          <span className="text-sm flex-1">{t(node.nameKey)}</span>
          <Badge variant="outline" className={`text-[10px] ${TYPE_COLORS[node.type] ?? ''}`}>
            {t(`type.${node.type}`)}
          </Badge>
        </div>
        {hasChildren && open && <TreeRows nodes={node.children} depth={depth + 1} />}
      </div>
    )
  }
}
