'use client'

import { useState, useEffect } from 'react'
import { useParams, useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPKR, formatDate } from '@/lib/utils/format'
import { ArrowLeft, Trash2, Pencil, X, Lock, Unlock } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { roleLabel, ROLES, ROLE_COLORS, ROLE_DESC, type Role } from '@/lib/constants'

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
  username: string | null; loginBlocked: boolean
  retailers: { id: string; name: string; area: string | null }[]
  attendance: { id: string; date: string; status: string; notes: string | null }[]
}

const emptyEditForm = {
  name: '', role: 'SALES_REP' as Role, phone: '', email: '', cnic: '',
  salary: '', joiningDate: '', username: '', password: '',
}

export default function EmployeeDetailPage() {
  const { id } = useParams<{ id: string }>()
  const router = useRouter()
  const [employee, setEmployee] = useState<Employee | null>(null)
  const [loading, setLoading] = useState(true)
  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState(emptyEditForm)

  const fetchEmployee = () => {
    setLoading(true)
    fetch(`/api/employees/${id}`).then(r => r.json()).then(j => setEmployee(j.data)).finally(() => setLoading(false))
  }

  useEffect(() => { fetchEmployee() }, [id])

  const startEdit = () => {
    if (!employee) return
    setForm({
      name: employee.name,
      role: employee.role as Role,
      phone: employee.phone ?? '',
      email: employee.email ?? '',
      cnic: employee.cnic ?? '',
      salary: employee.salary ? String(employee.salary) : '',
      joiningDate: employee.joiningDate ? employee.joiningDate.slice(0, 10) : '',
      username: employee.username ?? '',
      password: '',
    })
    setEditing(true)
  }

  const saveEdit = async () => {
    if (!form.name || !form.role) { toast.error('Name and role are required'); return }
    if (form.username && !employee?.username && !form.password) {
      toast.error('Password is required when setting a username for the first time')
      return
    }
    setSaving(true)
    const res = await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        salary: form.salary ? parseFloat(form.salary) : null,
        username: form.username.trim() || null,
        password: form.password || undefined,
        isActive: employee?.isActive ?? true,
      }),
    })
    if (res.ok) {
      toast.success('Employee updated')
      setEditing(false)
      fetchEmployee()
    } else {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error ?? 'Failed to update employee')
    }
    setSaving(false)
  }

  const toggleLoginBlocked = async () => {
    if (!employee) return
    const blocking = !employee.loginBlocked
    if (!confirm(blocking ? 'Block this employee from logging into the ERP?' : 'Unblock ERP login for this employee?')) return
    const res = await fetch(`/api/employees/${id}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: employee.name, role: employee.role, phone: employee.phone, email: employee.email,
        cnic: employee.cnic, salary: employee.salary, joiningDate: employee.joiningDate,
        isActive: employee.isActive, loginBlocked: blocking,
      }),
    })
    if (res.ok) { toast.success(blocking ? 'Login blocked' : 'Login unblocked'); fetchEmployee() }
    else toast.error('Failed to update login status')
  }

  const deleteEmployee = async () => {
    if (!confirm('Deactivate this employee?')) return
    const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Employee deactivated'); router.push('/hr') }
    else toast.error('Failed')
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

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
          <div className="flex items-center gap-1.5 mt-1">
            <Badge>{roleLabel(employee.role)}</Badge>
            {employee.loginBlocked && <Badge className="bg-red-100 text-red-700">Login Blocked</Badge>}
          </div>
        </div>
        {!editing && (
          <>
            <Button variant="outline" size="sm" className="gap-1" onClick={startEdit}>
              <Pencil size={14} /> Edit
            </Button>
            {employee.username && (
              <Button
                variant="outline" size="sm"
                className={`gap-1 ${employee.loginBlocked ? 'text-green-600 border-green-200 hover:bg-green-50' : 'text-red-600 border-red-200 hover:bg-red-50'}`}
                onClick={toggleLoginBlocked}
              >
                {employee.loginBlocked ? <><Unlock size={14} /> Unblock Login</> : <><Lock size={14} /> Block Login</>}
              </Button>
            )}
            <Button variant="outline" size="sm" className="text-red-600 border-red-200 hover:bg-red-50 gap-1" onClick={deleteEmployee}>
              <Trash2 size={14} /> Deactivate
            </Button>
          </>
        )}
      </div>

      {editing && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-blue-900">Edit Employee</p>
              <button onClick={() => setEditing(false)}><X size={16} className="text-slate-400" /></button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Full Name *</Label>
                <Input className="h-8 text-sm" value={form.name} onChange={set('name')} />
              </div>

              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Role *</Label>
                <div className="flex flex-wrap gap-1.5">
                  {ROLES.map(r => (
                    <button
                      key={r}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, role: r }))}
                      title={ROLE_DESC[r]}
                      className={`px-3 py-1 rounded text-xs font-medium border transition-all ${
                        form.role === r
                          ? `${ROLE_COLORS[r]} border-transparent shadow-sm`
                          : 'border-slate-300 text-slate-500 hover:border-slate-400 bg-white'
                      }`}
                    >
                      {roleLabel(r)}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">{ROLE_DESC[form.role]}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input className="h-8 text-sm" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Email</Label>
                <Input className="h-8 text-sm" value={form.email} onChange={set('email')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CNIC</Label>
                <Input className="h-8 text-sm" value={form.cnic} onChange={set('cnic')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Salary (PKR)</Label>
                <Input className="h-8 text-sm" type="number" value={form.salary} onChange={set('salary')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Joining Date</Label>
                <Input className="h-8 text-sm" type="date" value={form.joiningDate} onChange={set('joiningDate')} />
              </div>

              <div className="col-span-2 border-t pt-3 mt-1">
                <p className="text-xs font-medium text-slate-600 mb-2">ERP Login Credentials</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Username</Label>
                    <Input className="h-8 text-sm" placeholder="e.g. ali.sales" value={form.username} onChange={set('username')} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">New Password</Label>
                    <Input className="h-8 text-sm" type="password" placeholder="Leave blank to keep current" value={form.password} onChange={set('password')} />
                  </div>
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => setEditing(false)}>Cancel</Button>
              <Button size="sm" onClick={saveEdit} disabled={saving}>{saving ? 'Saving...' : 'Save Changes'}</Button>
            </div>
          </CardContent>
        </Card>
      )}

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
            <Row label="ERP Login" value={employee.username ? `${employee.username}${employee.loginBlocked ? ' (blocked)' : ''}` : 'No login'} />
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
          <CardHeader><CardTitle className="text-base">Assigned Customers ({employee.retailers.length})</CardTitle></CardHeader>
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
