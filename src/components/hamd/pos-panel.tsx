'use client'

/**
 * POS panel — product search + cart + checkout.
 *
 * Per /upload/pos.md: a simplified POS screen with:
 *  - Quick product search (by name/SKU)
 *  - Cart on the side with live totals (subtotal + tax + total)
 *  - Single "Checkout" button that calls /api/pos/sale
 *  - Receipt display after successful sale
 *
 * All text via i18n. All amounts via Intl formatters. RTL-aware.
 */
import { useEffect, useState, useCallback, useMemo } from 'react'
import { useI18n, useFormatNumber } from '@/core/i18n/client'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Badge } from '@/components/ui/badge'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { Loader2, Search, ShoppingCart, CheckCircle2, Plus, Minus, Trash2, X } from 'lucide-react'
import { toast } from 'sonner'

interface StockLevel {
  id: string
  warehouseId: string
  quantity: string
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

interface CartItem {
  product: Product
  quantity: number
}

interface PosSaleResponse {
  invoice: {
    id: string
    number: string
    channel: string
    status: string
  }
  totalRevenue: number
  totalTax: number
  totalAmount: number
  totalCogs: number
  netProfit: number
  revenueJournalEntryId: string
  cogsJournalEntryIds: string[]
}

interface Props {
  canSell: boolean
}

const DEFAULT_TAX_RATE = 0.14 // EG VAT — matches the Egypt TaxProvider

export function PosPanel({ canSell }: Props) {
  const { t } = useI18n()
  const formatNumber = useFormatNumber()
  const [products, setProducts] = useState<Product[]>([])
  const [warehouses, setWarehouses] = useState<Warehouse[]>([])
  const [loading, setLoading] = useState(true)
  const [search, setSearch] = useState('')
  const [cart, setCart] = useState<CartItem[]>([])
  const [customerName, setCustomerName] = useState('عميل نقطة البيع')
  const [warehouseId, setWarehouseId] = useState('')
  const [checkingOut, setCheckingOut] = useState(false)
  const [receipt, setReceipt] = useState<PosSaleResponse | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [pr, wr] = await Promise.all([
        fetch('/api/products', { cache: 'no-store', credentials: 'include' }),
        fetch('/api/warehouses', { cache: 'no-store', credentials: 'include' }),
      ])
      if (!pr.ok || !wr.ok) throw new Error()
      setProducts(await pr.json())
      const whs = await wr.json()
      setWarehouses(whs)
      const def = whs.find((w: Warehouse) => w.isDefault) ?? whs[0]
      if (def) setWarehouseId(def.id)
    } catch {
      toast.error(t('common.error'))
    } finally {
      setLoading(false)
    }
  }, [t])

  useEffect(() => {
    void load()
  }, [load])

  // Filter products by search query (SKU or translated name)
  const filteredProducts = useMemo(() => {
    if (!search.trim()) return products
    const q = search.toLowerCase()
    return products.filter((p) =>
      p.sku.toLowerCase().includes(q) || t(p.nameKey).toLowerCase().includes(q)
    )
  }, [products, search, t])

  // Get stock for a product at the selected warehouse
  function getStock(productId: string): number {
    const p = products.find((x) => x.id === productId)
    if (!p || !warehouseId) return 0
    const sl = p.stockLevels.find((s) => s.warehouseId === warehouseId)
    return sl ? Number(sl.quantity) : 0
  }

  function addToCart(product: Product) {
    setCart((prev) => {
      const existing = prev.find((c) => c.product.id === product.id)
      if (existing) {
        return prev.map((c) =>
          c.product.id === product.id ? { ...c, quantity: c.quantity + 1 } : c
        )
      }
      return [...prev, { product, quantity: 1 }]
    })
  }

  function updateQty(productId: string, delta: number) {
    setCart((prev) =>
      prev
        .map((c) =>
          c.product.id === productId ? { ...c, quantity: c.quantity + delta } : c
        )
        .filter((c) => c.quantity > 0)
    )
  }

  function setQty(productId: string, qty: number) {
    if (qty <= 0) {
      setCart((prev) => prev.filter((c) => c.product.id !== productId))
      return
    }
    setCart((prev) =>
      prev.map((c) => (c.product.id === productId ? { ...c, quantity: qty } : c))
    )
  }

  function removeFromCart(productId: string) {
    setCart((prev) => prev.filter((c) => c.product.id !== productId))
  }

  // Cart totals
  const subtotal = cart.reduce((s, c) => s + Number(c.product.sellPrice) * c.quantity, 0)
  const taxAmount = Math.round(subtotal * DEFAULT_TAX_RATE * 100) / 100
  const total = subtotal + taxAmount

  async function handleCheckout() {
    if (cart.length === 0) {
      toast.error(t('pos.emptyCart'))
      return
    }
    if (!warehouseId) {
      toast.error(t('pos.warehouse'))
      return
    }
    setCheckingOut(true)
    setReceipt(null)
    try {
      const r = await fetch('/api/pos/sale', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          warehouseId,
          customerName,
          lines: cart.map((c) => ({
            productId: c.product.id,
            quantity: c.quantity,
            unitPrice: Number(c.product.sellPrice),
          })),
        }),
      })
      const d = await r.json()
      if (!r.ok) {
        toast.error(d?.error?.message ?? t('common.error'))
        return
      }
      setReceipt(d)
      setCart([])
      toast.success(t('pos.saleComplete'))
      void load() // refresh stock levels
    } catch {
      toast.error(t('common.error'))
    } finally {
      setCheckingOut(false)
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-12 text-muted-foreground">
        <Loader2 className="h-6 w-6 animate-spin" />
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <ShoppingCart className="h-6 w-6 text-accent" />
        <div>
          <h1 className="text-xl font-semibold">{t('pos.title')}</h1>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Product search + grid (2 cols) */}
        <div className="lg:col-span-2 space-y-4">
          <Card>
            <CardContent className="p-3">
              <div className="relative">
                <Search className="absolute top-1/2 -translate-y-1/2 start-3 h-4 w-4 text-muted-foreground" />
                <Input
                  type="text"
                  placeholder={t('pos.searchProducts')}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  className="ps-9"
                />
              </div>
            </CardContent>
          </Card>

          {filteredProducts.length === 0 ? (
            <Card>
              <CardContent className="py-8 text-center text-sm text-muted-foreground">
                {t('pos.noProducts')}
              </CardContent>
            </Card>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
              {filteredProducts.map((p) => {
                const stock = getStock(p.id)
                const outOfStock = stock <= 0
                return (
                  <button
                    key={p.id}
                    onClick={() => !outOfStock && addToCart(p)}
                    disabled={outOfStock || !canSell}
                    className={`text-start rounded-lg border border-border p-3 transition-colors ${
                      outOfStock || !canSell
                        ? 'opacity-50 cursor-not-allowed'
                        : 'hover:border-accent hover:bg-accent/5 cursor-pointer'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2 mb-1">
                      <span className="font-mono text-xs text-muted-foreground">{p.sku}</span>
                      <Badge variant="outline" className={`text-[10px] ${outOfStock ? 'bg-danger/10 text-danger' : 'bg-success/10 text-success'}`}>
                        {t('pos.stock')}: {formatNumber(stock, { minimumFractionDigits: 0 })}
                      </Badge>
                    </div>
                    <div className="text-sm font-medium mb-2">{t(p.nameKey)}</div>
                    <div className="text-lg font-mono font-bold text-accent">
                      {formatNumber(Number(p.sellPrice), { minimumFractionDigits: 2 })}
                    </div>
                  </button>
                )
              })}
            </div>
          )}
        </div>

        {/* Cart sidebar (1 col) */}
        <div className="space-y-4">
          <Card>
            <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <ShoppingCart className="h-4 w-4" />
                {t('pos.cart')}
              </CardTitle>
              {cart.length > 0 && (
                <Button variant="ghost" size="sm" onClick={() => setCart([])} className="h-7 text-xs">
                  <X className="h-3 w-3" />
                </Button>
              )}
            </CardHeader>
            <CardContent className="space-y-3">
              {/* Customer + warehouse */}
              <div className="space-y-2">
                <div>
                  <Label htmlFor="posCustomer" className="text-xs">{t('pos.customerName')}</Label>
                  <Input
                    id="posCustomer"
                    value={customerName}
                    onChange={(e) => setCustomerName(e.target.value)}
                    className="h-8 text-sm"
                  />
                </div>
                <div>
                  <Label htmlFor="posWh" className="text-xs">{t('pos.warehouse')}</Label>
                  <Select value={warehouseId} onValueChange={setWarehouseId}>
                    <SelectTrigger id="posWh" className="h-8 text-sm"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {warehouses.map((w) => (
                        <SelectItem key={w.id} value={w.id}>{t(w.nameKey)}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Cart items */}
              {cart.length === 0 ? (
                <div className="py-4 text-center text-sm text-muted-foreground">{t('pos.emptyCart')}</div>
              ) : (
                <div className="space-y-1 max-h-64 overflow-y-auto hamd-scroll">
                  {cart.map((c) => (
                    <div key={c.product.id} className="flex items-center gap-2 py-1.5 border-b border-border/50 last:border-0">
                      <div className="flex-1 min-w-0">
                        <div className="text-xs font-medium truncate">{t(c.product.nameKey)}</div>
                        <div className="text-[10px] text-muted-foreground font-mono">
                          {formatNumber(Number(c.product.sellPrice), { minimumFractionDigits: 2 })} × {c.quantity}
                        </div>
                      </div>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => updateQty(c.product.id, -1)}>
                          <Minus className="h-3 w-3" />
                        </Button>
                        <Input
                          type="number"
                          value={c.quantity}
                          onChange={(e) => setQty(c.product.id, Number(e.target.value))}
                          className="h-6 w-12 text-center text-xs p-0"
                          min="1"
                        />
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0" onClick={() => updateQty(c.product.id, 1)}>
                          <Plus className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-danger" onClick={() => removeFromCart(c.product.id)}>
                          <Trash2 className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Totals */}
              {cart.length > 0 && (
                <div className="space-y-1 pt-2 border-t border-border">
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t('pos.subtotal')}</span>
                    <span className="font-mono">{formatNumber(subtotal, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-xs">
                    <span className="text-muted-foreground">{t('pos.tax')} (14%)</span>
                    <span className="font-mono">{formatNumber(taxAmount, { minimumFractionDigits: 2 })}</span>
                  </div>
                  <div className="flex justify-between text-base font-bold pt-1 border-t border-border">
                    <span>{t('pos.total')}</span>
                    <span className="font-mono text-accent">{formatNumber(total, { minimumFractionDigits: 2 })}</span>
                  </div>
                </div>
              )}

              {/* Checkout button */}
              {canSell && (
                <Button
                  onClick={handleCheckout}
                  disabled={checkingOut || cart.length === 0}
                  className="w-full h-11 text-base"
                >
                  {checkingOut ? <Loader2 className="h-5 w-5 animate-spin" /> : <CheckCircle2 className="h-5 w-5" />}
                  <span className="ms-2">{t('pos.checkout')}</span>
                </Button>
              )}
            </CardContent>
          </Card>

          {/* Receipt */}
          {receipt && (
            <Card className="border-success/30 bg-success/5">
              <CardHeader>
                <CardTitle className="text-base flex items-center gap-2 text-success">
                  <CheckCircle2 className="h-5 w-5" />
                  {t('pos.receipt')}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('pos.invoiceNumber')}</span>
                  <span className="font-mono font-medium">{receipt.invoice.number}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('pos.subtotal')}</span>
                  <span className="font-mono">{formatNumber(receipt.totalRevenue, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-muted-foreground">{t('pos.tax')}</span>
                  <span className="font-mono">{formatNumber(receipt.totalTax, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between font-bold pt-1 border-t border-border">
                  <span>{t('pos.total')}</span>
                  <span className="font-mono">{formatNumber(receipt.totalAmount, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-xs text-muted-foreground pt-1">
                  <span>{t('pos.cogs')}</span>
                  <span className="font-mono">{formatNumber(receipt.totalCogs, { minimumFractionDigits: 2 })}</span>
                </div>
                <div className="flex justify-between text-xs font-medium text-success pt-1 border-t border-border">
                  <span>{t('pos.netProfit')}</span>
                  <span className="font-mono">{formatNumber(receipt.netProfit, { minimumFractionDigits: 2 })}</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  className="w-full mt-2"
                  onClick={() => setReceipt(null)}
                >
                  {t('pos.newSale')}
                </Button>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  )
}
