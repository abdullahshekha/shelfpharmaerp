'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Trash2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUS_COLORS: Record<string, string> = {
  PRESENT: 'bg-green-100 text-green-700',
  ABSENT: 'bg-red-100 text-red-700',
  HALF_DAY: 'bg-yellow-100 text-yellow-700',
  LEAVE: 'bg-blue-100 text-blue-700',
}

interface Employee {
  id: string; name: string; role: string; phone: string | null
  email: string | null; cnic: string | null; salary: number | null
  joiningDate: string | null; isActive: boolean
  retailers: { id: string; name: string; area: string | null }[]
  attendance: { id: string; date: string; status: string; notes: string | null }[]
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    fetch(`/api/employees/${id}`).then(r => r.json()).then(j => setEmployee(j.data)).finally(() => setLoading(false))
  }, [id])

  const deleteEmployee = async () => {
    if (!confirm('Deactivate this employee?')) return
    const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Employee deactivated'); router.push('/hr') }
    else toast.error('Failed')
  }

  if (loading) return <div className="animate-pulse p-8 text-slate-400">Loading...</div>
  if (!employee) return <div className="p-8 text-slate-400">Employee not found.</div>

  // Monthly attendance summary from last 30 records
  const summary = employee.attendance.reduce<Record<string, number>>((acc, a) => {
    acc[a.status] = (acc[a.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="space-y-6 max-w-4xl">
      <div className="flex items-center gap-3">
        <Link href="/hr"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{employee.name}</h1>
          <Badge className="mt-1">{employee.role}</Badge>
        </div>
        <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={deleteEmployee}>
          <Trash2 size={14} /> Deactivate
        </Button>
      </div>

      <div className="grid md:grid-cols-2 gap-6">
        <Card>
          <CardHeader><CardTitle className="text-base">Details</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            <Row label="Phone" value={employee.phone ?? '—'} />
            <Row label="Email" value={employee.email ?? '—'} />
            <Row label="CNIC" value={employee.cnic ?? '—'} />
            <Row label="Salary" value={employee.salary ? formatPKR(employee.salary) : '—'} />
            <Row label="Joined" value={employee.joiningDate ? formatDate(employee.joiningDate) : '—'} />
            <Row label="Status" value={employee.isActive ? 'Active' : 'Inactive'} />
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle className="text-base">Attendance (Last 31 Days)</CardTitle></CardHeader>
          <CardContent className="space-y-2 text-sm">
            {Object.entries(summary).map(([status, count]) => (
              <div key={status} className="flex justify-between">
                <Badge className={`text-xs ${STATUS_COLORS[status] ?? ''}`}>{status.replace('_', ' ')}</Badge>
                <span className="font-medium">{count} days</span>
              </div>
            ))}
            {Object.keys(summary).length === 0 && <p className="text-slate-400">No attendance recorded yet.</p>}
          </CardContent>
        </Card>
      </div>

      {employee.retailers.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">Assigned Retailers ({employee.retailers.length})</CardTitle></CardHeader>
          <CardContent className="p-0">
            <table className="w-full text-sm">
              <tbody>
                {employee.retailers.map(r => (
                  <tr key={r.id} className="border-b hover:bg-slate-50 cursor-pointer" onClick={() => router.push(`/retailers/${r.id}`)}>
                    <td className="px-4 py-2 font-medium">{r.name}</td>
                    <td className="px-4 py-2 text-slate-500">{r.area ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">Recent Attendance</CardTitle></CardHeader>
        <CardContent className="p-0">
          {employee.attendance.length === 0 ? (
            <p className="p-4 text-slate-400 text-sm">No records.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {employee.attendance.map(a => (
                  <tr key={a.id} className="border-b">
                    <td className="px-4 py-2">{formatDate(a.date)}</td>
                    <td className="px-4 py-2">
                      <Badge className={`text-xs ${STATUS_COLORS[a.status] ?? ''}`}>{a.status.replace('_', ' ')}</Badge>
                    </td>
                    <td className="px-4 py-2 text-slate-400">{a.notes ?? ''}</td>
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

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  )
}
