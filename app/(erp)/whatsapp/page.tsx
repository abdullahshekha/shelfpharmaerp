'use client'

import { useState, useEffect, useCallback, useRef } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { MessageSquare, Upload, ImageIcon, Clock, Trash2 } from 'lucide-react'
import { formatDateTime } from '@/lib/utils/format'
import { toast } from 'sonner'


interface WaOrder {
  id: string
  phoneNumber: string
  status: string
  createdAt: string
  retailer: { name: string } | null
  extractedItems: string | null
}

const STATUS_COLORS: Record<string, string> = {
  PENDING_REVIEW: 'bg-slate-100 text-slate-700',
  AI_PROCESSED: 'bg-yellow-100 text-yellow-800',
  CONFIRMED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-700',
  AUTO_REPLY_SENT: 'bg-blue-100 text-blue-700',
}

export default function WhatsappPage() {
  const router = useRouter()
  const fileRef = useRef<HTMLInputElement>(null)
  const [orders, setOrders] = useState<WaOrder[]>([])
  const [loading, setLoading] = useState(true)
  const [uploading, setUploading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const fetchOrders = useCallback(async () => {
    setLoading(true)
    const res = await fetch('/api/whatsapp')
    const json = await res.json()
    setOrders(json.data ?? [])
    setLoading(false)
  }, [])

  useEffect(() => { fetchOrders() }, [fetchOrders])

  const processImage = async (file: File) => {
    if (!file.type.startsWith('image/')) {
      toast.error('Please upload an image file (JPEG, PNG, etc.)')
      return
    }
    setUploading(true)
    const form = new FormData()
    form.append('image', file)
    form.append('phoneNumber', 'MANUAL')

    try {
      const res = await fetch('/api/whatsapp/process-image', { method: 'POST', body: form })
      const json = await res.json()
      if (!res.ok) throw new Error(json.error ?? 'Processing failed')
      toast.success(`Extracted ${json.data.itemCount} items — review the order`)
      router.push(`/whatsapp/${json.data.id}`)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Upload failed')
      setUploading(false)
    }
  }

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) processImage(file)
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setDragging(false)
    const file = e.dataTransfer.files[0]
    if (file) processImage(file)
  }

  const itemCount = (order: WaOrder) => {
    if (!order.extractedItems) return 0
    try { return JSON.parse(order.extractedItems).length } catch { return 0 }
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <MessageSquare size={22} /> WhatsApp Orders
        </h1>
        <p className="text-slate-500 text-sm">{orders.length} orders processed</p>
      </div>

      {/* Upload area */}
      <Card className="overflow-visible">
        <CardHeader>
          <CardTitle className="text-base">Upload Order Image</CardTitle>
        </CardHeader>
        <CardContent>
          <div
            className={`border-2 border-dashed rounded-xl p-10 text-center cursor-pointer transition-colors ${
              dragging ? 'border-blue-500 bg-blue-50' : 'border-slate-300 hover:border-blue-400 hover:bg-slate-50'
            } ${uploading ? 'opacity-60 pointer-events-none' : ''}`}
            onClick={() => fileRef.current?.click()}
            onDragOver={e => { e.preventDefault(); setDragging(true) }}
            onDragLeave={() => setDragging(false)}
            onDrop={handleDrop}
          >
            {uploading ? (
              <div className="space-y-3">
                <div className="animate-spin h-8 w-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto" />
                <p className="text-slate-600 font-medium">Processing with Claude AI…</p>
                <p className="text-slate-400 text-sm">Reading handwriting and matching medicines</p>
              </div>
            ) : (
              <div className="space-y-3">
                <div className="flex justify-center gap-3 text-slate-300">
                  <ImageIcon size={48} />
                </div>
                <p className="text-slate-700 font-medium">
                  {dragging ? 'Drop image here' : 'Click or drag to upload a retailer order image'}
                </p>
                <p className="text-slate-400 text-sm">JPEG, PNG · Handwritten order photos from WhatsApp</p>
                <Button size="sm" className="gap-2 mt-2" type="button" onClick={e => { e.stopPropagation(); fileRef.current?.click() }}>
                  <Upload size={14} /> Choose Image
                </Button>
              </div>
            )}
          </div>
          <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFileChange} />

          {/* Test image shortcuts */}
          <div className="mt-4 pt-4 border-t">
            <p className="text-xs text-slate-500 mb-2 font-medium">Quick test — use a sample image:</p>
            <div className="flex flex-wrap gap-2">
              {['01', '02', '03', '04'].map(n => (
                <Button
                  key={n}
                  variant="outline"
                  size="sm"
                  className="text-xs gap-1"
                  disabled={uploading}
                  onClick={async () => {
                    setUploading(true)
                    const res = await fetch(`/whatsapp-test-images/${n}.jpeg`)
                    const blob = await res.blob()
                    const file = new File([blob], `sample-${n}.jpeg`, { type: 'image/jpeg' })
                    await processImage(file)
                  }}
                >
                  <ImageIcon size={11} /> Sample {n}
                </Button>
              ))}
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Orders list */}
      <Card>
        <CardHeader><CardTitle className="text-base">Recent WhatsApp Orders</CardTitle></CardHeader>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 text-slate-400 text-sm animate-pulse">Loading...</div>
          ) : orders.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <MessageSquare size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No orders yet</p>
              <p className="text-sm mt-1">Upload a retailer order image above to get started</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Retailer</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Time</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Items</th>
                  <th className="text-center px-4 py-3 font-medium text-slate-600">Status</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody>
                {orders.map(o => (
                  <tr key={o.id} className="border-b hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <div className="font-medium">{o.retailer?.name ?? 'Manual Upload'}</div>
                      <div className="text-xs text-slate-400">{o.phoneNumber}</div>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      <div className="flex items-center gap-1">
                        <Clock size={12} />
                        {formatDateTime(o.createdAt)}
                      </div>
                    </td>
                    <td className="px-4 py-3 text-center font-medium">{itemCount(o)}</td>
                    <td className="px-4 py-3 text-center">
                      <Badge className={`text-xs ${STATUS_COLORS[o.status] ?? ''}`}>
                        {o.status.replace('_', ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center gap-2 justify-end">
                        <Button
                          size="sm"
                          variant={o.status === 'AI_PROCESSED' ? 'default' : 'outline'}
                          onClick={() => router.push(`/whatsapp/${o.id}`)}
                        >
                          {o.status === 'AI_PROCESSED' ? 'Review →' : 'View'}
                        </Button>
                        <Button
                          size="sm" variant="ghost"
                          className="text-red-400 hover:text-red-600 hover:bg-red-50"
                          onClick={async () => {
                            if (!confirm('Delete this WhatsApp order?')) return
                            const res = await fetch(`/api/whatsapp/${o.id}`, { method: 'DELETE' })
                            if (res.ok) { toast.success('Deleted'); fetchOrders() }
                            else toast.error('Failed to delete')
                          }}
                        >
                          <Trash2 size={14} />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
