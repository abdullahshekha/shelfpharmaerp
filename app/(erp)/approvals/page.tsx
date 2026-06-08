'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { formatDate } from '@/lib/utils/format'
import { CheckSquare, CheckCircle, XCircle, Clock } from 'lucide-react'
import { toast } from 'sonner'

interface Approval {
  id: string
  model: string
  recordId: string
  recordLabel: string
  status: string
  createdAt: string
  reviewedAt: string | null
  reviewNote: string | null
  requestedBy: { name: string; role: string }
}

const STATUS_COLORS: Record<string, string> = {
  PENDING: 'bg-yellow-100 text-yellow-800',
  APPROVED: 'bg-green-100 text-green-800',
  REJECTED: 'bg-red-100 text-red-800',
}

export default function ApprovalsPage() {
  const [approvals, setApprovals] = useState<Approval[]>([])
  const [filter, setFilter] = useState<'PENDING' | 'APPROVED' | 'REJECTED' | ''>('PENDING')
  const [loading, setLoading] = useState(true)
  const [reviewingId, setReviewingId] = useState<string | null>(null)
  const [reviewNote, setReviewNote] = useState('')

  const fetch_ = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/approvals${filter ? `?status=${filter}` : '?status='}`)
    const j = await res.json()
    setApprovals(j.data ?? [])
    setLoading(false)
  }, [filter])

  useEffect(() => { fetch_() }, [fetch_])

  const resolve = async (id: string, action: 'APPROVE' | 'REJECT') => {
    const res = await fetch(`/api/approvals/${id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, reviewNote }),
    })
    if (res.ok) {
      toast.success(action === 'APPROVE' ? 'Deletion approved and executed.' : 'Deletion rejected.')
      setReviewingId(null)
      setReviewNote('')
      fetch_()
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed')
    }
  }

  const pending = approvals.filter(a => a.status === 'PENDING')

  return (
    <div className="max-w-4xl space-y-6">
      <div className="flex items-center gap-3">
        <CheckSquare size={22} className="text-blue-600" />
        <div>
          <h1 className="text-2xl font-bold">Approval Queue</h1>
          <p className="text-slate-500 text-sm">Manager delete requests pending admin review</p>
        </div>
        {pending.length > 0 && (
          <Badge className="ml-auto bg-red-500 text-white">{pending.length} pending</Badge>
        )}
      </div>

      {/* Filter tabs */}
      <div className="flex gap-2">
        {(['PENDING', 'APPROVED', 'REJECTED', ''] as const).map(f => (
          <Button
            key={f}
            size="sm"
            variant={filter === f ? 'default' : 'outline'}
            onClick={() => setFilter(f)}
          >
            {f === '' ? 'All' : f === 'PENDING' ? `Pending (${pending.length})` : f.charAt(0) + f.slice(1).toLowerCase()}
          </Button>
        ))}
      </div>

      {loading ? (
        <div className="space-y-3">
          {[1, 2, 3].map(i => <div key={i} className="h-20 bg-slate-100 rounded animate-pulse" />)}
        </div>
      ) : approvals.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-slate-400">
            <CheckCircle size={32} className="mx-auto mb-3 text-slate-300" />
            No {filter.toLowerCase() || ''} requests.
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {approvals.map(a => (
            <Card key={a.id} className={a.status === 'PENDING' ? 'border-yellow-200' : ''}>
              <CardContent className="pt-4 space-y-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <Badge className={STATUS_COLORS[a.status] ?? ''}>{a.status}</Badge>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock size={11} /> {formatDate(a.createdAt)}
                      </span>
                    </div>
                    <p className="font-medium text-slate-900">
                      Delete <span className="text-blue-700">{a.model}</span>: {a.recordLabel}
                    </p>
                    <p className="text-sm text-slate-500 mt-0.5">
                      Requested by <strong>{a.requestedBy.name}</strong> ({a.requestedBy.role})
                    </p>
                    {a.reviewedAt && (
                      <p className="text-xs text-slate-400 mt-1">
                        Resolved {formatDate(a.reviewedAt)}{a.reviewNote ? ` · "${a.reviewNote}"` : ''}
                      </p>
                    )}
                  </div>

                  {a.status === 'PENDING' && (
                    <div className="flex gap-2 flex-shrink-0">
                      <Button
                        size="sm"
                        className="gap-1 bg-green-600 hover:bg-green-700"
                        onClick={() => setReviewingId(reviewingId === a.id ? null : a.id)}
                      >
                        <CheckCircle size={14} /> Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        className="gap-1 text-red-600 border-red-200 hover:bg-red-50"
                        onClick={() => { setReviewingId(a.id + '-reject'); setReviewNote('') }}
                      >
                        <XCircle size={14} /> Reject
                      </Button>
                    </div>
                  )}
                </div>

                {/* Review form */}
                {(reviewingId === a.id || reviewingId === a.id + '-reject') && (
                  <div className="border-t pt-3 space-y-2">
                    <Input
                      placeholder="Optional note to manager..."
                      className="text-sm h-8"
                      value={reviewNote}
                      onChange={e => setReviewNote(e.target.value)}
                    />
                    <div className="flex gap-2">
                      {reviewingId === a.id && (
                        <Button size="sm" className="bg-green-600 hover:bg-green-700" onClick={() => resolve(a.id, 'APPROVE')}>
                          Confirm Approve & Execute Delete
                        </Button>
                      )}
                      {reviewingId === a.id + '-reject' && (
                        <Button size="sm" variant="outline" className="text-red-600 border-red-200" onClick={() => resolve(a.id, 'REJECT')}>
                          Confirm Reject
                        </Button>
                      )}
                      <Button size="sm" variant="ghost" onClick={() => { setReviewingId(null); setReviewNote('') }}>
                        Cancel
                      </Button>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
