'use client'

/**
 * Inventory panel — shows products (with stock levels) and warehouses.
 *
 * Two cards side by side:
 *  - Products: list with SKU, name, cost/sell price, total stock
 *  - Warehouses: list with name, default flag
 *
 * Create buttons for both (requires inventory:adjust permission).
 */
import { useEffect, useState, useCallback } from 'react'
import { useI18n, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Loader2, Plus, Package, Warehouse as WarehouseIcon } from 'lucide-react'
import { toast } from 'sonner'

interface StockLevel {
  id: string
  warehouseId: string
  quantity: string
  warehouse: { id: string; nameKey: string }
}
interface Product {
  id: string
  sku: string
  nameKey: string
  costPrice: string
  sellPrice: string
  stockLevels: StockLevel[]
}
interface Warehouse {
  id: string
  nameKey: string
  isDefault: boolean
}

interface Props {
  canAdjust: boolean
}

export function InventoryPanel({ canAdjust }: Props) {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [showProductForm, setShowProductForm] = useState(false)
  const [showWarehouseForm, setShowWarehouseForm] = useState(false)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pr, wr] = await Promise.all([
        fetch('/api/products', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/warehouses', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!pr.ok || !wr.ok) throw new Error()
      setProducts(await pr.json())
      setWarehouses(await wr.json())
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  function totalStock(p: Product): number {
    return p.stockLevels.reduce((s, sl) => s + Number(sl.quantity), 0)
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Package className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('inventory.title')}</h1>
          <p className="text-xs text-muted-foreground">
            {products.length} {t('inventory.products')} · {warehouses.length} {t('inventory.warehouses')}
          </p>
        </div>
      </div>

      {/* Products Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('inventory.products')}</CardTitle>
          {canAdjust && (
            <Button onClick={() => setShowProductForm((s) => !s)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t('inventory.createProduct')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showProductForm && canAdjust && (
            <ProductForm
              onClose={() => setShowProductForm(false)}
              onSaved={() => { setShowProductForm(false); void load() }}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-8 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : products.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t('inventory.empty')}</div>
          ) : (
            <div className="max-h-96 overflow-y-auto hamd-scroll">
              {/* Desktop table header — hidden on mobile */}
              <div className="hidden sm:grid grid-cols-12 gap-2 text-xs font-medium text-muted-foreground px-2 py-1 border-b border-border">
                <div className="col-span-2">{t('inventory.sku')}</div>
                <div className="col-span-3">{t('inventory.name')}</div>
                <div className="col-span-2 text-end">{t('inventory.costPrice')}</div>
                <div className="col-span-2 text-end">{t('inventory.sellPrice')}</div>
                <div className="col-span-3 text-end">{t('inventory.stock')}</div>
              </div>
              {products.map((p) => (
                <div key={p.id}>
                  {/* Desktop row — hidden on mobile */}
                  <div className="hidden sm:grid grid-cols-12 gap-2 px-2 py-2 border-b border-border/50 text-sm items-center">
                    <div className="col-span-2 font-mono text-xs">{p.sku}</div>
                    <div className="col-span-3">{t(p.nameKey)}</div>
                    <div className="col-span-2 text-end font-mono">{formatNumber(Number(p.costPrice), { minimumFractionDigits: 2 })}</div>
                    <div className="col-span-2 text-end font-mono">{formatNumber(Number(p.sellPrice), { minimumFractionDigits: 2 })}</div>
                    <div className="col-span-3 text-end">
                      <span className="font-mono font-medium">{formatNumber(totalStock(p), { minimumFractionDigits: 0 })}</span>
                      {p.stockLevels.length > 0 && (
                        <div className="text-[10px] text-muted-foreground">
                          {p.stockLevels.map((sl) => `${t(sl.warehouse.nameKey)}: ${Number(sl.quantity)}`).join(' · ')}
                        </div>
                      )}
                    </div>
                  </div>
                  {/* Mobile card — hidden on sm+ */}
                  <div className="sm:hidden rounded-md border border-border/60 p-3 mb-2">
                    <div className="flex items-start justify-between gap-2 mb-2">
                      <div className="min-w-0">
                        <div className="font-mono text-[10px] text-muted-foreground">{p.sku}</div>
                        <div className="text-sm font-medium truncate">{t(p.nameKey)}</div>
                      </div>
                      <Badge variant="outline" className="text-[10px] shrink-0">
                        {t('inventory.stock')}: {formatNumber(totalStock(p), { minimumFractionDigits: 0 })}
                      </Badge>
                    </div>
                    <div className="flex justify-between text-xs">
                      <div>
                        <div className="text-muted-foreground">{t('inventory.costPrice')}</div>
                        <div className="font-mono">{formatNumber(Number(p.costPrice), { minimumFractionDigits: 2 })}</div>
                      </div>
                      <div className="text-end">
                        <div className="text-muted-foreground">{t('inventory.sellPrice')}</div>
                        <div className="font-mono font-medium text-accent">{formatNumber(Number(p.sellPrice), { minimumFractionDigits: 2 })}</div>
                      </div>
                    </div>
                    {p.stockLevels.length > 0 && (
                      <div className="text-[10px] text-muted-foreground mt-2 pt-2 border-t border-border/40">
                        {p.stockLevels.map((sl) => `${t(sl.warehouse.nameKey)}: ${Number(sl.quantity)}`).join(' · ')}
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Warehouses Card */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="text-base">{t('inventory.warehouses')}</CardTitle>
          {canAdjust && (
            <Button onClick={() => setShowWarehouseForm((s) => !s)} size="sm" className="gap-2">
              <Plus className="h-4 w-4" />
              <span>{t('inventory.createWarehouse')}</span>
            </Button>
          )}
        </CardHeader>
        <CardContent>
          {showWarehouseForm && canAdjust && (
            <WarehouseForm
              onClose={() => setShowWarehouseForm(false)}
              onSaved={() => { setShowWarehouseForm(false); void load() }}
            />
          )}

          {loading ? (
            <div className="flex items-center justify-center py-4 text-muted-foreground">
              <Loader2 className="h-5 w-5 animate-spin" />
            </div>
          ) : warehouses.length === 0 ? (
            <div className="py-4 text-center text-sm text-muted-foreground">{t('inventory.empty')}</div>
          ) : (
            <div className="space-y-1">
              {warehouses.map((w) => (
                <div key={w.id} className="flex items-center justify-between py-2 px-2 rounded hover:bg-muted/50">
                  <div className="flex items-center gap-2">
                    <WarehouseIcon className="h-4 w-4 text-muted-foreground" />
                    <span className="text-sm">{t(w.nameKey)}</span>
                    {w.isDefault && <Badge variant="secondary" className="text-[10px]">{t('inventory.default')}</Badge>}
                  </div>
                  <span className="text-xs font-mono text-muted-foreground">{w.id}</span>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  )
}

// ---------- Product Form ----------

function ProductForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [sku, setSku] = useState('')
  const [nameKey, setNameKey] = useState('')
  const [sellPrice, setSellPrice] = useState('0')
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await fetch('/api/products', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ sku, nameKey, sellPrice: Number(sellPrice) }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('inventory.createProduct'))
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
          <Label htmlFor="sku">{t('inventory.sku')}</Label>
          <Input id="sku" value={sku} onChange={(e) => setSku(e.target.value)} placeholder="PROD-001" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="nameKey">{t('inventory.name')} (key)</Label>
          <Input id="nameKey" value={nameKey} onChange={(e) => setNameKey(e.target.value)} placeholder="product.laptop" required />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="sellPrice">{t('inventory.sellPrice')}</Label>
          <Input id="sellPrice" type="number" step="0.01" min="0" value={sellPrice} onChange={(e) => setSellPrice(e.target.value)} required />
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

// ---------- Warehouse Form ----------

function WarehouseForm({ onClose, onSaved }: { onClose: () => void; onSaved: () => void }) {
  const { t } = useI18n()
  const [nameKey, setNameKey] = useState('')
  const [isDefault, setIsDefault] = useState(false)
  const [saving, setSaving] = useState(false)

  async function handleSave(e: React.FormEvent) {
    e.preventDefault()
    setSaving(true)
    try {
      const r = await fetch('/api/warehouses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ nameKey, isDefault }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      toast.success(t('inventory.createWarehouse'))
      onSaved()
    } catch {
      toast.error(t('common.error'))
    } finally {
      setSaving(false)
    }
  }

  return (
    <form onSubmit={handleSave} className="mb-4 p-3 rounded-md border border-border space-y-3">
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="whNameKey">{t('inventory.name')} (key)</Label>
          <Input id="whNameKey" value={nameKey} onChange={(e) => setNameKey(e.target.value)} placeholder="warehouse.main" required />
        </div>
        <div className="flex items-end gap-2 pb-2">
          <input
            id="whDefault"
            type="checkbox"
            checked={isDefault}
            onChange={(e) => setIsDefault(e.target.checked)}
            className="h-4 w-4"
          />
          <Label htmlFor="whDefault" className="text-sm font-normal cursor-pointer">{t('inventory.default')}</Label>
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
