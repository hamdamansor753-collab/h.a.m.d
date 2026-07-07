'use client'

/**
 * Manufacturing panel — Bill of Materials (BOM) + Production Orders.
 *
 * Two cards:
 *  - BOM Management (canManage = manufacturing:manage)
 *      · list existing BOMs (finished product, labor cost/unit, raw material components)
 *      · create BOM form (select finished product, labor cost, dynamic raw material line items)
 *  - Production Orders (canRun = production:run)
 *      · list existing production orders (finished product, qty, warehouse, status, totals if completed)
 *      · create production order form (select product that HAS a BOM, qty, warehouse)
 *      · "Complete" button on DRAFT orders — calls POST /api/production-orders/[id]/complete
 *
 * Patterns mirrored from inventory-panel.tsx + purchase-orders-panel.tsx:
 *  - 'use client', useI18n(), useFormatNumber(), useFormatDate()
 *  - fetch with cache:'no-store' + credentials:'include'
 *  - toast from sonner, Card/CardContent/CardHeader/CardTitle, Button, Input, Label, Select, Badge, Loader2
 *  - dual-rendering (desktop grid `hidden sm:grid` + mobile card `sm:hidden`)
 *  - all text via t('key')
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatNumber, useFormatDate } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Plus, Factory, CheckCircle2, Trash2, Package } from 'lucide-react'
import { toast } from 'sonner'

// ---------- Types ----------

interface Product {
  id: string
  sku: string
  nameKey: string
  costPrice: string
  sellPrice: string
}
interface Warehouse {
  id: string
  nameKey: string
  isDefault: boolean
}
interface BOMComponent {
  id: string
  rawMaterialProductId: string
  quantityPerUnit: string
  rawMaterial: { id: string; sku: string; nameKey: string }
}
interface BOM {
  id: string
  finishedProductId: string
  laborCostPerUnit: string
  components: BOMComponent[]
  finishedProduct: { id: string; sku: string; nameKey: string }
}
interface ProductionOrder {
  id: string
  finishedProductId: string
  quantity: string
  warehouseId: string
  status: 'DRAFT' | 'COMPLETED' | 'CANCELLED'
  totalMaterialCost: string | null
  totalLaborCost: string | null
  journalEntryId?: string | null
  createdAt: string
}

interface Props {
  canManage: boolean  // manufacturing:manage — can create BOMs
  canRun: boolean     // production:run — can create / complete production orders
}

const STATUS_COLORS: Record<string, string> = {
  DRAFT: 'bg-muted text-muted-foreground border-border',
  COMPLETED: 'bg-success/15 text-success border-success/30',
  CANCELLED: 'bg-danger/15 text-danger border-danger/30',
}

// ---------- Main Panel ----------

export function ManufacturingPanel({ canManage, canRun }: Props) {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const formatDate = useFormatDate()
  const [boms, setBoms] = useState<BOM[]>([])
  const [orders, setOrders] = useState<ProductionOrder[]>([])
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [showBOMForm, setShowBOMForm] = useState(false)
  const [showPOForm, setShowPOForm] = useState(false)
  const [completingId, setCompletingId] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [br, orR, prR, wrR] = await Promise.all([
        fetch('/api/bom', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/production-orders', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/products', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/warehouses', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!br.ok || !orR.ok || !prR.ok || !wrR.ok) throw new Error()
      setBoms(await br.json())
      setOrders(await orR.json())
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

  async function handleComplete(id: string) {
    if (!confirm(t('manufacturing.complete') + '?')) return
    setCompletingId(id)
    try {
      const r = await fetch(`/api/production-orders/${id}/complete`, {
        method: 'POST',
        credentials: 'include',
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('manufacturing.completed'))
      void load()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setCompletingId(null)
    }
  }

  // helpers
  // ProductRef is the minimum shape needed for label rendering; BOMs return
  // nested product refs without costPrice/sellPrice, so accept the narrower shape.
  const productLabel = (p: { sku: string; nameKey: string }) => `${p.sku} · ${t(p.nameKey)}`
  const warehouseLabel = (w: Warehouse) => t(w.nameKey)
  const productNameById = (id: string) => {
    const p = products.find((x) => x.id === id)
    return p ? productLabel(p) : id
  }
  const warehouseNameById = (id: string) => {
    const w = warehouses.find((x) => x.id === id)
    return w ? warehouseLabel(w) : id
  }
  const hasBOM = (productId: string) => boms.some((b) => b.finishedProductId === productId)

  return (
    <div className="space-y-4">
      {/* Title */}
      <div className="flex items-center gap-3">
        <Factory className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('manufacturing.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {boms.length} {t('manufacturing.boms')} · {orders.length} {t('manufacturing.productionOrders')}
          </p>
        </div>
      </div>

      {/* ============ BOM Management ============ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('manufacturing.boms')}</CardTitle>
          {canManage && (
            <Button onClick={() => setShowBOMForm((s) => !s)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t('manufacturing.createBOM')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showBOMForm && canManage && products.length > 0 && (
            <BOMForm
              products={products}
              existingFinishedIds={new Set(boms.map((b) => b.finishedProductId))}
              productLabel={productLabel}
              onClose={() => setShowBOMForm(false)}
              onSaved={() => { setShowBOMForm(false); void load() }}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : boms.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('manufacturing.noBOMs')}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto hamd-scroll space-y-2">
              {boms.map((bom) => (
                <div key={bom.id} className="rounded-md border border-border p-3">
                  <div className="flex items-start justify-between gap-2 mb-2">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <Package className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-sm font-medium">{productLabel(bom.finishedProduct)}</span>
                      </div>
                      <div className="text-[10px] text-muted-foreground mt-0.5">
                        {t('manufacturing.laborCostPerUnit')}: {' '}
                        <span className="font-mono">{formatNumber(Number(bom.laborCostPerUnit), { minimumFractionDigits: 2 })}</span>
                      </div>
                    </div>
                    <Badge variant="outline" className="text-[10px] shrink-0">
                      {bom.components.length} {t('manufacturing.components')}
                    </Badge>
                  </div>
                  {/* Components list — same on desktop + mobile (compact stack) */}
                  <div className="text-xs text-muted-foreground space-y-0.5 mt-1 pt-2 border-t border-border/40">
                    {bom.components.map((c) => (
                      <div key={c.id} className="flex justify-between gap-2">
                        <span className="truncate">{productLabel(c.rawMaterial)}</span>
                        <span className="font-mono shrink-0">
                          {formatNumber(Number(c.quantityPerUnit), { minimumFractionDigits: 2 })}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* ============ Production Orders ============ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('manufacturing.productionOrders')}</CardTitle>
          {canRun && (
            <Button
              onClick={() => setShowPOForm((s) => !s)}
              size="sm"
              className="gap-2"
              disabled={boms.length === 0}
              title={boms.length === 0 ? t('manufacturing.noBOMs') : undefined}
            >
              <Plus className="h-4 w-4" />
              <span>{t('manufacturing.createProductionOrder')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showPOForm && canRun && boms.length > 0 && products.length > 0 && warehouses.length > 0 && (
            <ProductionOrderForm
              boms={boms}
              products={products}
              warehouses={warehouses}
              productLabel={productLabel}
              warehouseLabel={warehouseLabel}
              onClose={() => setShowPOForm(false)}
              onSaved={() => { setShowPOForm(false); void load() }}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : orders.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">
              {t('manufacturing.noProductionOrders')}
            </div>
          ) : (
            <div className="max-h-[60vh] overflow-y-auto hamd-scroll space-y-2">
              {orders.map((o) => {
                const totalCost =
                  o.status === 'COMPLETED' && o.totalMaterialCost != null && o.totalLaborCost != null
                    ? Number(o.totalMaterialCost) + Number(o.totalLaborCost)
                    : null
                return (
                  <div key={o.id} className="rounded-md border border-border p-3">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2 flex-wrap">
                          <span className="text-sm font-medium truncate">{productNameById(o.finishedProductId)}</span>
                          <Badge variant="outline" className={`text-[10px] ${STATUS_COLORS[o.status]}`}>
                            {t(`manufacturing.${o.status.toLowerCase()}`)}
                          </Badge>
                        </div>
                        <div className="text-[10px] text-muted-foreground mt-0.5">
                          {formatDate(o.createdAt)}
                        </div>
                      </div>
                      <div className="text-end shrink-0">
                        <div className="text-sm font-mono font-medium">
                          {formatNumber(Number(o.quantity), { minimumFractionDigits: 0 })}
                        </div>
                        <div className="text-[10px] text-muted-foreground">{t('manufacturing.quantity')}</div>
                      </div>
                    </div>

                    {/* Warehouse */}
                    <div className="text-xs text-muted-foreground mb-2">
                      {t('manufacturing.warehouse')}: <span className="text-foreground">{warehouseNameById(o.warehouseId)}</span>
                    </div>

                    {/* Costs (only if completed) */}
                    {o.status === 'COMPLETED' && o.totalMaterialCost != null && o.totalLaborCost != null && (
                      <div className="text-xs space-y-0.5 mt-2 pt-2 border-t border-border/40">
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t('manufacturing.totalMaterialCost')}</span>
                          <span className="font-mono">{formatNumber(Number(o.totalMaterialCost), { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between">
                          <span className="text-muted-foreground">{t('manufacturing.totalLaborCost')}</span>
                          <span className="font-mono">{formatNumber(Number(o.totalLaborCost), { minimumFractionDigits: 2 })}</span>
                        </div>
                        <div className="flex justify-between pt-1 border-t border-border/30 mt-1">
                          <span className="font-medium">{t('manufacturing.totalCost')}</span>
                          <span className="font-mono font-medium">{formatNumber(totalCost ?? 0, { minimumFractionDigits: 2 })}</span>
                        </div>
                      </div>
                    )}

                    {o.status === 'DRAFT' && canRun && (
                      <Button
                        variant="default"
                        size="sm"
                        onClick={() => handleComplete(o.id)}
                        disabled={completingId === o.id}
                        className="gap-1.5 text-xs h-9 w-full mt-2"
                      >
                        {completingId === o.id ? (
                          <Loader2 className="h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <CheckCircle2 className="h-3.5 w-3.5" />
                        )}
                        <span>{t('manufacturing.complete')}</span>
                      </Button>
                    )}
                  </div>
                )
              })}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- BOM Form ----------

function BOMForm({
  products,
  existingFinishedIds,
  productLabel,
  onClose,
  onSaved,
}: {
  products: Product[]
  existingFinishedIds: Set<string>
  productLabel: (p: Product) => string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  const [finishedProductId, setFinishedProductId] = useState('')
  const [laborCostPerUnit, setLaborCostPerUnit] = useState('0')
  const [components, setComponents] = useState<Array<{ rawMaterialProductId: string; quantityPerUnit: string }>>(
    [{ rawMaterialProductId: '', quantityPerUnit: '1' }]
  )
  const [saving, setSaving] = useState(false)

  function addComponent() {
    setComponents((prev) => [...prev, { rawMaterialProductId: '', quantityPerUnit: '1' }])
  }
  function updateComponent(i: number, patch: Partial<{ rawMaterialProductId: string; quantityPerUnit: string }>) {
    setComponents((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)))
  }
  function removeComponent(i: number) {
    setComponents((prev) => prev.filter((_, idx) => idx !== i))
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!finishedProductId) {
      toast.error(t('manufacturing.selectProduct'))
      return
    }
    if (components.some((c) => !c.rawMaterialProductId || Number(c.quantityPerUnit) <= 0)) {
      toast.error(t('manufacturing.components'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/bom', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          finishedProductId,
          laborCostPerUnit: Number(laborCostPerUnit),
          components: components.map((c) => ({
            rawMaterialProductId: c.rawMaterialProductId,
            quantityPerUnit: Number(c.quantityPerUnit),
          })),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('manufacturing.createBOM'))
      onSaved()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="mb-4 p-3 rounded-md border border-border space-y-3">
      {/* Finished product + labor cost */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="bomFinished">{t('manufacturing.finishedProduct')}</Label>
          <Select value={finishedProductId} onValueChange={setFinishedProductId}>
            <SelectTrigger id="bomFinished"><SelectValue placeholder={t('manufacturing.selectProduct')} /></SelectTrigger>
            <SelectContent>
              {products.map((p) => (
                <SelectItem key={p.id} value={p.id} disabled={existingFinishedIds.has(p.id)}>
                  <span className="flex items-center gap-2">
                    <span>{productLabel(p)}</span>
                    {existingFinishedIds.has(p.id) && (
                      <Badge variant="secondary" className="text-[9px] h-4 px-1">
                        {t('manufacturing.productHasBOM')}
                      </Badge>
                    )}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="bomLabor">{t('manufacturing.laborCostPerUnit')}</Label>
          <Input
            id="bomLabor"
            type="number"
            step="0.01"
            min="0"
            value={laborCostPerUnit}
            onChange={(e) => setLaborCostPerUnit(e.target.value)}
            required
          />
        </div>
      </div>

      {/* Components (dynamic line items) */}
      <div className="space-y-2">
        <Label>{t('manufacturing.components')}</Label>
        {/* Desktop header — hidden on mobile */}
        <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-1">
          <div className="col-span-8">{t('manufacturing.rawMaterial')}</div>
          <div className="col-span-3 text-end">{t('manufacturing.quantityPerUnit')}</div>
          <div className="col-span-1"></div>
        </div>
        {components.map((c, i) => (
          <div key={i}>
            {/* Desktop row — hidden on mobile */}
            <div className="hidden sm:grid grid-cols-12 gap-2 items-center">
              <div className="col-span-8">
                <Select value={c.rawMaterialProductId} onValueChange={(v) => updateComponent(i, { rawMaterialProductId: v })}>
                  <SelectTrigger><SelectValue placeholder={t('manufacturing.rawMaterial')} /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id} disabled={p.id === finishedProductId}>
                        {productLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Input
                className="col-span-3 text-end font-mono"
                type="number"
                step="0.01"
                min="0.01"
                value={c.quantityPerUnit}
                onChange={(e) => updateComponent(i, { quantityPerUnit: e.target.value })}
              />
              <div className="col-span-1 flex justify-center">
                <Button type="button" variant="ghost" size="sm" onClick={() => removeComponent(i)} disabled={components.length <= 1}>
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            </div>
            {/* Mobile stacked card — hidden on sm+ */}
            <div className="sm:hidden rounded-md border border-border/60 p-3 space-y-2">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">{t('manufacturing.rawMaterial')}</Label>
                <Select value={c.rawMaterialProductId} onValueChange={(v) => updateComponent(i, { rawMaterialProductId: v })}>
                  <SelectTrigger><SelectValue placeholder={t('manufacturing.rawMaterial')} /></SelectTrigger>
                  <SelectContent>
                    {products.map((p) => (
                      <SelectItem key={p.id} value={p.id} disabled={p.id === finishedProductId}>
                        {productLabel(p)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">{t('manufacturing.quantityPerUnit')}</Label>
                <Input
                  className="text-end font-mono"
                  type="number"
                  step="0.01"
                  min="0.01"
                  value={c.quantityPerUnit}
                  onChange={(e) => updateComponent(i, { quantityPerUnit: e.target.value })}
                />
              </div>
              <Button type="button" variant="ghost" size="sm" onClick={() => removeComponent(i)} disabled={components.length <= 1} className="w-full text-danger h-9">
                <Trash2 className="h-3.5 w-3.5" />
                <span className="ms-1 text-xs">{t('common.cancel')}</span>
              </Button>
            </div>
          </div>
        ))}
        <Button type="button" variant="outline" size="sm" onClick={addComponent} className="gap-2">
          <Plus className="h-3.5 w-3.5" />
          <span>{t('manufacturing.addComponent')}</span>
        </Button>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="ms-2">{t('common.save')}</span>
        </Button>
      </div>
    </form>
  )
}

// ---------- Production Order Form ----------

function ProductionOrderForm({
  boms,
  products,
  warehouses,
  productLabel,
  warehouseLabel,
  onClose,
  onSaved,
}: {
  boms: BOM[]
  products: Product[]
  warehouses: Warehouse[]
  productLabel: (p: Product) => string
  warehouseLabel: (w: Warehouse) => string
  onClose: () => void
  onSaved: () => void
}) {
  const { t } = useI18n()
  // Only products that have a BOM can be produced
  const producibleProducts = products.filter((p) => boms.some((b) => b.finishedProductId === p.id))
  const [finishedProductId, setFinishedProductId] = useState('')
  const [quantity, setQuantity] = useState('1')
  const defaultWh = warehouses.find((w) => w.isDefault) ?? warehouses[0]
  const [warehouseId, setWarehouseId] = useState(defaultWh?.id ?? '')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    if (!finishedProductId) {
      toast.error(t('manufacturing.selectProduct'))
      return
    }
    if (Number(quantity) <= 0) {
      toast.error(t('manufacturing.quantity'))
      return
    }
    setSaving(true)
    try {
      const r = await fetch('/api/production-orders', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          finishedProductId,
          quantity: Number(quantity),
          warehouseId,
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('manufacturing.createProductionOrder'))
      onSaved()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="mb-4 p-3 rounded-md border border-border space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="poFinished">{t('manufacturing.finishedProduct')}</Label>
          <Select value={finishedProductId} onValueChange={setFinishedProductId}>
            <SelectTrigger id="poFinished"><SelectValue placeholder={t('manufacturing.selectProduct')} /></SelectTrigger>
            <SelectContent>
              {producibleProducts.map((p) => (
                <SelectItem key={p.id} value={p.id}>
                  <span className="flex items-center gap-2">
                    <span>{productLabel(p)}</span>
                    <Badge variant="secondary" className="text-[9px] h-4 px-1">
                      {t('manufacturing.productHasBOM')}
                    </Badge>
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="poQty">{t('manufacturing.quantity')}</Label>
          <Input
            id="poQty"
            type="number"
            step="1"
            min="0.01"
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            required
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="poWh">{t('manufacturing.warehouse')}</Label>
          <Select value={warehouseId} onValueChange={setWarehouseId}>
            <SelectTrigger id="poWh"><SelectValue /></SelectTrigger>
            <SelectContent>
              {warehouses.map((w) => (
                <SelectItem key={w.id} value={w.id}>{warehouseLabel(w)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div className="flex justify-end gap-2">
        <Button type="button" variant="outline" size="sm" onClick={onClose}>{t('common.cancel')}</Button>
        <Button type="submit" size="sm" disabled={saving}>
          {saving && <Loader2 className="h-4 w-4 animate-spin" />}
          <span className="ms-2">{t('common.save')}</span>
        </Button>
      </div>
    </form>
  )
}
