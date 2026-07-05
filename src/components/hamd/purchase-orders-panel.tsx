'use client'

/**
 * Purchase Orders panel — list, create, receive.
 *
 * Flow:
 *  - DRAFT POs: receivable (creates stock movements + JE)
 *  - RECEIVED POs: immutable, show received badge
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatDate, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, ShoppingCart, PackageCheck, Trash2 } from 'lucide-react'
import { toast } from 'sonner'

interface PurchaseOrderLine {
  id?: string
  productId: string
  quantity: string
  unitCost: string
  warehouseId: string
}
interface PurchaseOrder {
  id: string
  number: string
  supplierName: string
  date: string
  status: 'DRAFT' | 'RECEIVED' | 'CANCELLED'
  lines: PurchaseOrderLine[]
  journalEntryId?: string | null
}

interface Product { id: string; sku: string; nameKey: string }
interface Warehouse { id: string; nameKey: string; isDefault: boolean }

interface Props {
  canCreate: boolean
  canReceive: boolean
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  RECEIVED: 'bg-success/15 text-success border-success/30',
  CANCELLED: 'bg-danger/15 text-danger border-danger/30',
}

export function PurchaseOrdersPanel({ canCreate, canReceive }: Props) {
  const { t } = useI18n()
  const formatDate = useFormatDate()
  const formatNumber = useFormatNumber()
  const [orders, setOrders] = useState<PurchaseOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [poR, prR, wrR] = await Promise.all([
        fetch('/api/purchase-orders', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/products', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/warehouses', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!poR.ok || !prR.ok || !wrR.ok) throw new Error()
      setOrders(await poR.json())
      setProducts(await prR.json())
      setWarehouses(await wrR.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  async function handleReceive(id: string) {
    if (!confirm(t('purchaseOrder.receive') + '?')) return
    try {
      const r = await fetch(`/api/purchase-orders/${id}/receive`, { method: 'POST', credentials: 'include' })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('purchaseOrder.received'))
      void load()
    } catch {
      toast.error(t('common.error'))
    }
  }

  function lineTotal(l: PurchaseOrderLine): number {
    return Number(l.quantity) * Number(l.unitCost)
  }
  function orderTotal(po: PurchaseOrder): number {
    return po.lines.reduce((s, l) => s + lineTotal(l), 0)
  }

  const productLabel = (p: Product) => `${p.sku} · ${t(p.nameKey)}`
  const warehouseLabel = (w: Warehouse) => t(w.nameKey)

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <ShoppingCart className="h-6 w-6 text-accent" />
          <div>
            <h1 className="text-xl font-semibold">{t('purchaseOrder.title')}</h1>
            <p className="text-xs text-muted-foreground">{orders.length} {t('purchaseOrder.title')}</p>
          </div>
        </div>
        {canCreate && (
          <Button onClick={() => setShowForm((s) => !s)} size="sm" className="gap-2">
            <Plus className="h-4 w-4" />
            <span>{t('purchaseOrder.create')}</span>
          </Button>
        )}
      </div>

      {showForm && canCreate && products.length > 0 && warehouses.length > 0 && (
        <PurchaseOrderForm
          products={products}
          warehouses={warehouses}
          productLabel={productLabel}
          warehouseLabel={warehouseLabel}
          onClose={() => setShowForm(false)}
          onSaved={() => { setShowForm(false); void load() }}
        />
      )}

      <Card>
        <CardHeader>
          <CardTitle className="text-base">{t('purchaseOrder.title')}</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('purchaseOrder.empty')}</div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto hamd-scroll space-y-2">
              {orders.map((po) => (
                <div key={po.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <span className="font-mono text-sm font-medium">{po.number}</span>
                        <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[po.status]}`}>
                          {t(`purchaseOrder.status.${po.status}`)}
                        </Badge>
                      </div>
                      <div className="text-sm text-foreground mt-1">{po.supplierName}</div>
                      <div className="text-xs text-muted-foreground">{formatDate(po.date)}</div>
                    </div>
                    <div className="text-end shrink-0">
                      <div className="text-sm font-mono font-medium">{formatNumber(orderTotal(po), { minimumFractionDigits: 2 })}</div>
                      <div className="text-[10px] text-muted-foreground">{po.lines.length} {t('purchaseOrder.lines')}</div>
                    </div>
                  </div>
                  {/* Lines summary */}
                  <div className="text-xs text-muted-foreground space-y-0.5 mb-2">
                    {po.lines.map((l, i) => {
                      const p = products.find((p) => p.id === l.productId)
                      const w = warehouses.find((w) => w.id === l.warehouseId)
                      return (
                        <div key={i} className="flex justify-between">
                          <span>{p ? productLabel(p) : l.productId} × {Number(l.quantity)}</span>
                          <span className="font-mono">{formatNumber(lineTotal(l), { minimumFractionDigits: 2 })}</span>
                        </div>
                      )
                    })}
                  </div>
                  {po.status === 'DRAFT' && canReceive && (
                    <Button variant="default" size="sm" onClick={() => handleReceive(po.id)} className="gap-1.5 text-xs h-7 w-full">
                      <PackageCheck className="h-3.5 w-3.5" /> {t('purchaseOrder.receive')}
                    </Button>
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Purchase Order Form ----------

function PurchaseOrderForm({
  products,
  warehouses,
  productLabel,
  warehouseLabel,
  onClose,
  onSaved,
}: {
  products: Product[]
  warehouses: Warehouse[]
  productLabel: (p: Product) => string
  warehouseLabel: (w: Warehouse) => string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [supplierName, setSupplierName] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  const [lines, setLines] = useState<Array<{ productId: string; quantity: string; unitCost: string; warehouseId: string }>>(
    [{ productId: '', quantity: '1', unitCost: '0', warehouseId: defaultWh?.id ?? '' }]
  )
  const [saving, setSaving] = useState(false)

  function addLine() {
    setLines((prev) => [...prev, { productId: '', quantity: '1', unitCost: '0', warehouseId: defaultWh?.id ?? '' }])
  }
  function updateLine(i: number, patch: Partial<{ productId: string; quantity: string; unitCost: string; warehouseId: string }>) {
    setLines((prev) => prev.map((l, idx) => (idx === i ? { ...l, ...patch } : l)))
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, idx) => idx !== i))
  }

  const total = lines.reduce((s, l) => s + (Number(l.quantity) * Number(l.unitCost)), 0)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!supplierName.trim()) {
      toast.error(t('purchaseOrder.supplier'))
      return
    }
    if (lines.some((l) => !l.productId || Number(l.quantity) <= 0)) {
      toast.error(t('purchaseOrder.lines'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/purchase-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          supplierName,
          date: new Date(date).toISOString(),
          lines: lines.map((l) => ({
            productId: l.productId,
            quantity: Number(l.quantity),
            unitCost: Number(l.unitCost),
            warehouseId: l.warehouseId,
          })),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('purchaseOrder.create'))
      onSaved()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">{t('purchaseOrder.create')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form onSubmit={handleSave} className="space-y-3">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="supplier">{t('purchaseOrder.supplier')}</Label>
              <Input id="supplier" value={supplierName} onChange={(e) => setSupplierName(e.target.value)} required />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="poDate">{t('purchaseOrder.date')}</Label>
              <Input id="poDate" type="date" value={date} onChange={(e) => setDate(e.target.value)} required />
            </div>
          </div>

          <div className="space-y-2">
            <Label>{t('purchaseOrder.lines')}</Label>
            <div className="grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
              <div className="col-span-5">{t('purchaseOrder.product')}</div>
              <div className="col-span-2 text-end">{t('purchaseOrder.quantity')}</div>
              <div className="col-span-2 text-end">{t('purchaseOrder.unitCost')}</div>
              <div className="col-span-2">{t('purchaseOrder.warehouse')}</div>
              <div className="col-span-1"></div>
            </div>
            {lines.map((l, i) => (
              <div key={i} className="grid grid-cols-12 gap-2 items-center">
                <div className="col-span-5">
                  <Select value={l.productId} onValueChange={(v) => updateLine(i, { productId: v })}>
                    <SelectTrigger><SelectValue placeholder={t('purchaseOrder.product')} /></SelectTrigger>
                    <SelectContent>
                      {products.map((p) => (
                        <SelectItem key={p.id} value={p.id}>{productLabel(p)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <Input
                  className="col-span-2 text-end font-mono"
                  type="number"
                  step="1"
                  min="0.01"
                  value={l.quantity}
                  onChange={(e) => updateLine(i, { quantity: e.target.value })}
                />
                <Input
                  className="col-span-2 text-end font-mono"
                  type="number"
                  step="0.01"
                  min="0"
                  value={l.unitCost}
                  onChange={(e) => updateLine(i, { unitCost: e.target.value })}
                />
                <div className="col-span-2">
                  <Select value={l.warehouseId} onValueChange={(v) => updateLine(i, { warehouseId: v })}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{warehouseLabel(w)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="col-span-1 flex justify-center">
                  <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)} disabled={lines.length <= 1}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                </div>
              </div>
            ))}
            <Button type="button" variant="outline" size="sm" onClick={addLine} className="gap-2">
              <Plus className="h-3.5 w-3.5" />
              <span>{t('purchaseOrder.addLine')}</span>
            </Button>
          </div>

          <div className="flex items-center justify-between rounded-md border border-border p-3 text-sm">
            <span className="text-muted-foreground">{t('purchaseOrder.total')}</span>
            <span className="font-mono font-medium">{total.toFixed(2)}</span>
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={onClose}>{t('purchaseOrder.cancel')}</Button>
            <Button type="submit" disabled={saving}>
              {saving && <Loader2 className="h-4 w-4 animate-spin" />}
              <span className="ms-2">{t('purchaseOrder.save')}</span>
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
