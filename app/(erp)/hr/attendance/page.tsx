'use client'

import { useState, useEffect, useCallback } from 'react'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { ArrowLeft, ChevronLeft, ChevronRight, Save } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'

const STATUSES = ['PRESENT', 'ABSENT', 'HALF_DAY', 'LEAVE'] as const
type Status = typeof STATUSES[number]

const STATUS_COLORS: Record<Status, string> = {
  PRESENT: 'bg-green-100 text-green-700',
  ABSENT: 'bg-red-100 text-red-700',
  HALF_DAY: 'bg-yellow-100 text-yellow-700',
  LEAVE: 'bg-blue-100 text-blue-700',
}

interface Employee { id: string; name: string; role: string }
interface AttendanceRecord { employeeId: string; status: Status; notes: string }

function todayStr() {
  return new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Karachi' })).toISOString().slice(0, 10)
}

export default function AttendancePage() {
  const [date, setDate] = useState(todayStr())
  const [employees, setEmployees] = useState<Employee[]>([])
  const [records, setRecords] = useState<Record<string, AttendanceRecord>>({})
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)

  const fetchData = useCallback(async () => {
    setLoading(true)
    const res = await fetch(`/api/attendance?date=${date}`)
    const json = await res.json()
    setEmployees(json.data.employees ?? [])

    // Build records map from existing attendance
    const map: Record<string, AttendanceRecord> = {}
    for (const emp of json.data.employees ?? []) {
      map[emp.id] = { employeeId: emp.id, status: 'PRESENT', notes: '' }
    }
    for (const att of json.data.attendance ?? []) {
      map[att.employeeId] = { employeeId: att.employeeId, status: att.status, notes: att.notes ?? '' }
    }
    setRecords(map)
    setLoading(false)
  }, [date])

  useEffect(() => { fetchData() }, [fetchData])

  const shiftDate = (days: number) => {
    const d = new Date(date)
    d.setDate(d.getDate() + days)
    setDate(d.toISOString().slice(0, 10))
  }

  const setStatus = (employeeId: string, status: Status) => {
    setRecords(r => ({ ...r, [employeeId]: { ...r[employeeId], status } }))
  }

  const saveAttendance = async () => {
    setSaving(true)
    const res = await fetch('/api/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ date, records: Object.values(records) }),
    })
    if (res.ok) toast.success(`Attendance saved for ${date}`)
    else toast.error('Failed to save')
    setSaving(false)
  }

  const presentCount = Object.values(records).filter(r => r.status === 'PRESENT').length
  const absentCount = Object.values(records).filter(r => r.status === 'ABSENT').length

  return (
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center gap-3">
        <Link href="/hr"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold flex-1">Attendance</h1>
        <Button size="sm" className="gap-2" onClick={saveAttendance} disabled={saving || loading}>
          <Save size={14} /> {saving ? 'Saving...' : 'Save'}
        </Button>
      </div>

      {/* Date navigation */}
      <div className="flex items-center gap-2">
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDate(-1)}><ChevronLeft size={16} /></Button>
        <Input type="date" className="w-44 h-8 text-sm" value={date} onChange={e => setDate(e.target.value)} />
        <Button variant="outline" size="icon" className="h-8 w-8" onClick={() => shiftDate(1)}><ChevronRight size={16} /></Button>
        <Button variant="ghost" size="sm" className="text-xs text-slate-500" onClick={() => setDate(todayStr())}>Today</Button>
        <span className="text-sm text-slate-500 ml-2">
          {presentCount} present · {absentCount} absent
        </span>
      </div>

      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-2">{[1,2,3,4].map(i => <div key={i} className="h-12 bg-slate-100 rounded animate-pulse" />)}</div>
          ) : employees.length === 0 ? (
            <div className="p-12 text-center text-slate-400">
              No employees found. <Link href="/hr" className="text-blue-500 hover:underline">Add employees first.</Link>
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b bg-slate-50">
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Employee</th>
                  <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => {
                  const record = records[emp.id]
                  const status = record?.status ?? 'PRESENT'
                  return (
                    <tr key={emp.id} className="border-b">
                      <td className="px-4 py-3">
                        <div className="font-medium">{emp.name}</div>
                        <div className="text-xs text-slate-400">{emp.role}</div>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex gap-1 flex-wrap">
                          {STATUSES.map(s => (
                            <button
                              key={s}
                              onClick={() => setStatus(emp.id, s)}
                              className={`px-2 py-1 rounded text-xs font-medium border transition-all ${
                                status === s
                                  ? `${STATUS_COLORS[s]} border-transparent shadow-sm`
                                  : 'border-slate-200 text-slate-400 hover:border-slate-300'
                              }`}
                            >
                              {s.replace('_', ' ')}
                            </button>
                          ))}
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
