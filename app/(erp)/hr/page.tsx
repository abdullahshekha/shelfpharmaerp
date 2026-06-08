'use client'

import { useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { formatPKR } from '@/lib/utils/format'
import { UserCog, Plus, X, Phone, Trash2, KeyRound } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const ROLES = ['ADMIN', 'MANAGER', 'TEAM_LEAD', 'SALES_REP', 'WAREHOUSE', 'ACCOUNTANT'] as const
type Role = typeof ROLES[number]

const ROLE_COLORS: Record<Role, string> = {
  ADMIN:       'bg-purple-100 text-purple-800',
  MANAGER:     'bg-blue-100 text-blue-800',
  TEAM_LEAD:   'bg-cyan-100 text-cyan-700',
  SALES_REP:   'bg-green-100 text-green-700',
  WAREHOUSE:   'bg-slate-100 text-slate-700',
  ACCOUNTANT:  'bg-orange-100 text-orange-700',
}

const ROLE_DESC: Record<Role, string> = {
  ADMIN:      'Full access',
  MANAGER:    'Full access, deletes need admin approval',
  TEAM_LEAD:  'View + orders + payments',
  SALES_REP:  'Own retailers + orders only',
  WAREHOUSE:  'Inventory batches only',
  ACCOUNTANT: 'Invoices + supplier payments only',
}

interface Employee {
  id: string; name: string; role: string; phone: string | null
  salary: number | null; isActive: boolean; username: string | null
}

const emptyForm = {
  name: '', role: 'SALES_REP' as Role,
  phone: '', email: '', cnic: '', salary: '', joiningDate: '',
  username: '', password: '',
}

export default function HRPage() {
  const router = useRouter()
  const [employees, setEmployees] = useState<Employee[]>([])
  const [loading, setLoading] = useState(true)
  const [showForm, setShowForm] = useState(false)
  const [form, setForm] = useState(emptyForm)
  const [saving, setSaving] = useState(false)
  const [roleFilter, setRoleFilter] = useState<Role | ''>('')

  const fetchEmployees = useCallback(async () => {
    setLoading(true)
    const params = roleFilter ? `?role=${roleFilter}` : ''
    const res = await fetch(`/api/employees${params}`)
    const json = await res.json()
    setEmployees(json.data ?? [])
    setLoading(false)
  }, [roleFilter])

  useEffect(() => { fetchEmployees() }, [fetchEmployees])

  const createEmployee = async () => {
    if (!form.name || !form.role) { toast.error('Name and role are required'); return }
    if (form.username && !form.password) { toast.error('Password is required when setting a username'); return }
    setSaving(true)
    const res = await fetch('/api/employees', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        salary: form.salary ? parseFloat(form.salary) : null,
        username: form.username.trim() || undefined,
        password: form.password || undefined,
      }),
    })
    if (res.ok) {
      toast.success('Employee added')
      setShowForm(false)
      setForm(emptyForm)
      fetchEmployees()
    } else {
      const j = await res.json().catch(() => ({}))
      toast.error(j.error ?? 'Failed to add employee')
    }
    setSaving(false)
  }

  const deleteEmployee = async (id: string, name: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm(`Deactivate ${name}?`)) return
    const res = await fetch(`/api/employees/${id}`, { method: 'DELETE' })
    if (res.ok) { toast.success('Employee deactivated'); fetchEmployees() }
    else toast.error('Failed to deactivate')
  }

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2"><UserCog size={22} /> HR</h1>
          <p className="text-slate-500 text-sm">{employees.length} employees</p>
        </div>
        <div className="flex gap-2">
          <Link href="/hr/attendance">
            <Button variant="outline" size="sm">Attendance</Button>
          </Link>
          <Button size="sm" className="gap-2" onClick={() => setShowForm(true)}>
            <Plus size={16} /> Add Employee
          </Button>
        </div>
      </div>

      {/* Add employee form */}
      {showForm && (
        <Card className="border-blue-200 bg-blue-50">
          <CardContent className="pt-4 space-y-4">
            <div className="flex items-center justify-between">
              <p className="font-medium text-blue-900">New Employee</p>
              <button onClick={() => { setShowForm(false); setForm(emptyForm) }}>
                <X size={16} className="text-slate-400" />
              </button>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1 col-span-2">
                <Label className="text-xs">Full Name *</Label>
                <Input className="h-8 text-sm" placeholder="Muhammad Ali" value={form.name} onChange={set('name')} />
              </div>

              {/* Role selector */}
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
                      {r.replace(/_/g, ' ')}
                    </button>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-1">{ROLE_DESC[form.role]}</p>
              </div>

              <div className="space-y-1">
                <Label className="text-xs">Phone</Label>
                <Input className="h-8 text-sm" placeholder="0300-1234567" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">CNIC</Label>
                <Input className="h-8 text-sm" placeholder="42101-1234567-1" value={form.cnic} onChange={set('cnic')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Salary (PKR)</Label>
                <Input className="h-8 text-sm" type="number" placeholder="35000" value={form.salary} onChange={set('salary')} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Joining Date</Label>
                <Input className="h-8 text-sm" type="date" value={form.joiningDate} onChange={set('joiningDate')} />
              </div>

              {/* Login credentials */}
              <div className="col-span-2 border-t pt-3 mt-1">
                <p className="text-xs font-medium text-slate-600 flex items-center gap-1 mb-2">
                  <KeyRound size={12} /> ERP Login Credentials (optional)
                </p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <Label className="text-xs">Username</Label>
                    <Input className="h-8 text-sm" placeholder="e.g. ali.sales" value={form.username} onChange={set('username')} />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Password {form.username && '*'}</Label>
                    <Input className="h-8 text-sm" type="password" placeholder="Min 6 characters" value={form.password} onChange={set('password')} />
                  </div>
                </div>
                <p className="text-xs text-slate-400 mt-1">Leave blank to create an employee without ERP access. You can set credentials later from the employee detail page.</p>
              </div>
            </div>

            <div className="flex justify-end gap-2">
              <Button size="sm" variant="outline" onClick={() => { setShowForm(false); setForm(emptyForm) }}>Cancel</Button>
              <Button size="sm" onClick={createEmployee} disabled={saving}>
                {saving ? 'Saving...' : `Add ${form.role.replace(/_/g, ' ')}`}
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* Role filter */}
      <div className="flex gap-2 flex-wrap">
        <Button size="sm" variant={!roleFilter ? 'default' : 'outline'} onClick={() => setRoleFilter('')}>All</Button>
        {ROLES.map(r => (
          <Button key={r} size="sm" variant={roleFilter === r ? 'default' : 'outline'} onClick={() => setRoleFilter(r)}>
            {r.replace(/_/g, ' ')}
          </Button>
        ))}
      </div>

      {/* Employee table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">{[1,2,3].map(i => <div key={i} className="h-10 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : employees.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              <UserCog size={36} className="mx-auto mb-3 text-slate-300" />
              <p className="font-medium">No employees yet</p>
              <p className="text-sm mt-1">Click Add Employee above to get started</p>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Role</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 hidden sm:table-cell">Phone</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Login</th>
                  <th className="text-right px-4 py-3 font-medium text-slate-600 hidden md:table-cell">Salary</th>
                  <th className="w-10" />
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} className="border-b hover:bg-slate-50 cursor-pointer"
                    onClick={() => router.push(`/hr/${emp.id}`)}>
                    <td className="px-4 py-3 font-medium">{emp.name}</td>
                    <td className="px-4 py-3">
                      <Badge className={`text-xs ${ROLE_COLORS[emp.role as Role] ?? 'bg-slate-100 text-slate-700'}`}>
                        {emp.role.replace(/_/g, ' ')}
                      </Badge>
                    </td>
                    <td className="px-4 py-3 text-slate-500 hidden sm:table-cell">
                      {emp.phone ? <span className="flex items-center gap-1"><Phone size={12} />{emp.phone}</span> : '—'}
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {emp.username
                        ? <span className="flex items-center gap-1 text-green-600 text-xs"><KeyRound size={11} /> {emp.username}</span>
                        : <span className="text-slate-300 text-xs">No login</span>
                      }
                    </td>
                    <td className="px-4 py-3 text-right hidden md:table-cell">
                      {emp.salary ? formatPKR(emp.salary) : '—'}
                    </td>
                    <td className="px-4 py-3">
                      <button
                        onClick={(e) => deleteEmployee(emp.id, emp.name, e)}
                        className="text-red-400 hover:text-red-600 p-1"
                      >
                        <Trash2 size={14} />
                      </button>
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
