'use client'

import { useState, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Button } from '@/components/ui/button'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { ArrowLeft, MapPin, Camera, Loader2 } from 'lucide-react'
import Link from 'next/link'
import { toast } from 'sonner'
import { CUSTOMER_TYPES } from '@/lib/constants'
import { useCurrentUser } from '@/lib/hooks/useCurrentUser'
import { DrugLicensesEditor, type DrugLicenseForm } from '@/components/retailers/DrugLicensesEditor'

interface SalesRep { id: string; name: string }
interface Area { id: string; name: string }

export default function AddCustomerPage() {
  const router = useRouter()
  const { user } = useCurrentUser()
  const isOrderBooker = user?.role === 'SALES_REP'
  const [saving, setSaving] = useState(false)
  const [salesReps, setSalesReps] = useState<SalesRep[]>([])
  const [areas, setAreas] = useState<Area[]>([])
  const [locating, setLocating] = useState(false)
  const [uploadingPhoto, setUploadingPhoto] = useState(false)
  const [form, setForm] = useState({
    name: '', ownerName: '', phone: '', whatsappNumber: '',
    areaId: '', address: '', customerType: '',
    creditLimit: '0', creditDays: '0',
    paymentMode: 'CASH', salesRepId: '', notes: '',
    isFiler: 'false', ntnNumber: '', strnStatus: '', strnNumber: '',
    drapRegistered: false, latitude: '', longitude: '', storePhotoUrl: '',
  })
  const [drugLicenses, setDrugLicenses] = useState<DrugLicenseForm[]>([
    { licenseNumber: '', formNumber: '', expiryDate: '' },
  ])

  useEffect(() => {
    if (!isOrderBooker) {
      fetch('/api/employees?role=SALES_REP').then(r => r.json()).then(j => setSalesReps(j.data ?? []))
    }
    fetch('/api/areas').then(r => r.json()).then(j => setAreas(j.data ?? []))
  }, [isOrderBooker])

  const set = (field: string) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm(f => ({ ...f, [field]: e.target.value }))

  const isCheque = form.paymentMode === 'CHEQUE'

  const captureLocation = () => {
    if (!navigator.geolocation) { toast.error('Geolocation is not supported on this device'); return }
    setLocating(true)
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setForm(f => ({ ...f, latitude: String(pos.coords.latitude), longitude: String(pos.coords.longitude) }))
        setLocating(false)
      },
      () => {
        toast.error('Could not get location — check location permission for this browser')
        setLocating(false)
      },
      { enableHighAccuracy: true, timeout: 15000 }
    )
  }

  const uploadPhoto = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    setUploadingPhoto(true)
    const fd = new FormData()
    fd.append('photo', file)
    const res = await fetch('/api/retailers/upload-photo', { method: 'POST', body: fd })
    const j = await res.json().catch(() => ({}))
    if (res.ok) {
      setForm(f => ({ ...f, storePhotoUrl: j.data.url }))
      toast.success('Photo uploaded')
    } else {
      toast.error(j.error ?? 'Failed to upload photo')
    }
    setUploadingPhoto(false)
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!form.name) { toast.error('Name is required'); return }
    const isFiler = form.isFiler === 'true'
    if (isFiler && !form.ntnNumber.trim()) { toast.error('NTN Number is required for a Filer customer'); return }
    if (isFiler && form.strnStatus === 'REGISTERED' && !form.strnNumber.trim()) {
      toast.error('STRN Number is required when STRN is Registered')
      return
    }
    if (form.drapRegistered && !drugLicenses.some(l => l.licenseNumber.trim())) {
      toast.error('At least one Drug License is required for a DRAP Registered customer')
      return
    }
    setSaving(true)
    const res = await fetch('/api/retailers', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...form,
        areaId: form.areaId || null,
        customerType: form.customerType || null,
        creditLimit: isCheque ? (parseFloat(form.creditLimit) || 0) : 0,
        creditDays: isCheque ? (parseInt(form.creditDays) || 0) : 0,
        drugLicenses,
        // Order Booker's assignment is forced server-side regardless of what's sent
        salesRepId: isOrderBooker ? undefined : (form.salesRepId || null),
        isFiler,
        latitude: form.latitude ? parseFloat(form.latitude) : null,
        longitude: form.longitude ? parseFloat(form.longitude) : null,
        storePhotoUrl: form.storePhotoUrl || null,
      }),
    })
    if (res.ok) {
      toast.success('Customer added')
      router.push('/retailers')
    } else {
      const j = await res.json()
      toast.error(j.error ?? 'Failed to add customer')
    }
    setSaving(false)
  }

  return (
    <div className="max-w-2xl space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/retailers"><Button variant="ghost" size="icon"><ArrowLeft size={18} /></Button></Link>
        <h1 className="text-2xl font-bold">Add Customer</h1>
      </div>

      <form onSubmit={handleSubmit}>
        <Card>
          <CardHeader><CardTitle className="text-base">Customer Information</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-1.5 col-span-2">
                <Label>Customer Name *</Label>
                <Input placeholder="ABC Pharmacy" value={form.name} onChange={set('name')} />
              </div>
              <div className="space-y-1.5">
                <Label>Owner Name</Label>
                <Input placeholder="Muhammad Ali" value={form.ownerName} onChange={set('ownerName')} />
              </div>

              <div className="space-y-1.5">
                <Label>Customer Type</Label>
                <Select
                  items={CUSTOMER_TYPES.map(t => ({ value: t, label: t }))}
                  value={form.customerType || undefined}
                  onValueChange={v => setForm(f => ({ ...f, customerType: v ?? '' }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select customer type" /></SelectTrigger>
                  <SelectContent>
                    {CUSTOMER_TYPES.map(t => <SelectItem key={t} value={t}>{t}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>

              {/* Payment Mode */}
              <div className="space-y-1.5">
                <Label>Payment Mode *</Label>
                <Select value={form.paymentMode} onValueChange={v => setForm(f => ({ ...f, paymentMode: v ?? 'CASH' }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="CASH">Cash</SelectItem>
                    <SelectItem value="CHEQUE">Cheque</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              {/* Area dropdown */}
              <div className="space-y-1.5">
                <Label>Area</Label>
                <Select
                  items={[{ value: 'none', label: 'No area' }, ...areas.map(a => ({ value: a.id, label: a.name }))]}
                  value={form.areaId || 'none'} onValueChange={v => setForm(f => ({ ...f, areaId: v === 'none' ? '' : (v ?? '') }))}
                >
                  <SelectTrigger><SelectValue placeholder="Select area" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">No area</SelectItem>
                    {areas.map(a => <SelectItem key={a.id} value={a.id}>{a.name}</SelectItem>)}
                  </SelectContent>
                </Select>
                {areas.length === 0 && (
                  <p className="text-xs text-slate-400">
                    No areas yet. <Link href="/settings" className="text-blue-500 hover:underline">Add areas in Settings.</Link>
                  </p>
                )}
              </div>

              <div className="space-y-1.5">
                <Label>Phone</Label>
                <Input placeholder="0300-1234567" value={form.phone} onChange={set('phone')} />
              </div>
              <div className="space-y-1.5">
                <Label>WhatsApp Number</Label>
                <Input placeholder="923001234567" value={form.whatsappNumber} onChange={set('whatsappNumber')} />
              </div>
              <div className="space-y-1.5 col-span-2">
                <Label>Address</Label>
                <Input placeholder="Shop #12, Main Bahadurabad Road" value={form.address} onChange={set('address')} />
              </div>

              {/* Pin location */}
              <div className="space-y-1.5 col-span-2">
                <Label>Pin Location</Label>
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" size="sm" className="gap-1.5" onClick={captureLocation} disabled={locating}>
                    {locating ? <Loader2 size={14} className="animate-spin" /> : <MapPin size={14} />}
                    {locating ? 'Locating...' : form.latitude ? 'Recapture Location' : 'Use My Location'}
                  </Button>
                  {form.latitude && form.longitude && (
                    <span className="text-xs text-slate-500 font-mono">{Number(form.latitude).toFixed(6)}, {Number(form.longitude).toFixed(6)}</span>
                  )}
                </div>
              </div>

              {/* Store front photo */}
              <div className="space-y-1.5 col-span-2">
                <Label>Store Front Photo</Label>
                <div className="flex items-center gap-3">
                  <label className="inline-flex">
                    <input
                      type="file" accept="image/*" capture="environment"
                      className="hidden" onChange={uploadPhoto}
                    />
                    <span className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md border border-slate-300 text-sm cursor-pointer hover:border-slate-400">
                      {uploadingPhoto ? <Loader2 size={14} className="animate-spin" /> : <Camera size={14} />}
                      {uploadingPhoto ? 'Uploading...' : 'Take Photo'}
                    </span>
                  </label>
                  {form.storePhotoUrl && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={form.storePhotoUrl} alt="Store front" className="h-12 w-12 object-cover rounded border border-slate-200" />
                  )}
                </div>
              </div>

              {!isOrderBooker && (
                <div className="space-y-1.5 col-span-2">
                  <Label>Assigned ORDER BOOKER</Label>
                  <Select
                    items={[{ value: 'none', label: 'No sales rep' }, ...salesReps.map(rep => ({ value: rep.id, label: rep.name }))]}
                    value={form.salesRepId || 'none'} onValueChange={v => setForm(f => ({ ...f, salesRepId: v === 'none' ? '' : (v ?? '') }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select sales rep (optional)" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">No sales rep</SelectItem>
                      {salesReps.map(rep => <SelectItem key={rep.id} value={rep.id}>{rep.name}</SelectItem>)}
                    </SelectContent>
                  </Select>
                </div>
              )}
              {isOrderBooker && user && (
                <div className="space-y-1.5 col-span-2">
                  <Label>Assigned ORDER BOOKER</Label>
                  <p className="text-sm px-3 py-2 bg-slate-50 border border-slate-200 rounded-md text-slate-600">{user.name} (you)</p>
                </div>
              )}

              <DrugLicensesEditor licenses={drugLicenses} onChange={setDrugLicenses} required={form.drapRegistered} />

              <div className="space-y-1.5 col-span-2 flex items-center gap-2">
                <input
                  type="checkbox" id="drapRegistered" className="h-4 w-4 rounded border-slate-300"
                  checked={form.drapRegistered}
                  onChange={e => setForm(f => ({ ...f, drapRegistered: e.target.checked }))}
                />
                <Label htmlFor="drapRegistered" className="cursor-pointer">DRAP Registered</Label>
              </div>

              {/* Filer status */}
              <div className="space-y-1.5">
                <Label>Filer *</Label>
                <Select
                  items={[{ value: 'true', label: 'Yes' }, { value: 'false', label: 'No' }]}
                  value={form.isFiler}
                  onValueChange={v => setForm(f => ({ ...f, isFiler: v ?? 'false', ...(v !== 'true' ? { ntnNumber: '', strnStatus: '', strnNumber: '' } : {}) }))}
                >
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="true">Yes</SelectItem>
                    <SelectItem value="false">No</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              {form.isFiler === 'true' && (
                <div className="space-y-1.5">
                  <Label>NTN Number *</Label>
                  <Input placeholder="1234567-8" value={form.ntnNumber} onChange={set('ntnNumber')} />
                </div>
              )}
              {form.isFiler === 'true' && (
                <div className="space-y-1.5">
                  <Label>STRN Status *</Label>
                  <Select
                    items={[{ value: 'REGISTERED', label: 'Registered' }, { value: 'UNREGISTERED', label: 'Unregistered' }]}
                    value={form.strnStatus || undefined}
                    onValueChange={v => setForm(f => ({ ...f, strnStatus: v ?? '', ...(v !== 'REGISTERED' ? { strnNumber: '' } : {}) }))}
                  >
                    <SelectTrigger><SelectValue placeholder="Select STRN status" /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="REGISTERED">Registered</SelectItem>
                      <SelectItem value="UNREGISTERED">Unregistered</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
              )}
              {form.isFiler === 'true' && form.strnStatus === 'REGISTERED' && (
                <div className="space-y-1.5">
                  <Label>STRN Number *</Label>
                  <Input placeholder="03-12-3456-789-01" value={form.strnNumber} onChange={set('strnNumber')} />
                </div>
              )}

              {/* Credit fields — only visible for Cheque */}
              {isCheque && (
                <>
                  <div className="space-y-1.5">
                    <Label>Credit Limit (PKR)</Label>
                    <Input type="number" value={form.creditLimit} onChange={set('creditLimit')} />
                  </div>
                  <div className="space-y-1.5">
                    <Label>Credit Days</Label>
                    <Input type="number" value={form.creditDays} onChange={set('creditDays')} />
                  </div>
                </>
              )}
              <div className="space-y-1.5 col-span-2">
                <Label>Notes</Label>
                <Input placeholder="Any special notes..." value={form.notes} onChange={set('notes')} />
              </div>
            </div>

            <div className="flex justify-end gap-3 pt-2">
              <Link href="/retailers"><Button type="button" variant="outline">Cancel</Button></Link>
              <Button type="submit" disabled={saving}>{saving ? 'Saving...' : 'Add Customer'}</Button>
            </div>
          </CardContent>
        </Card>
      </form>
    </div>
  )
}
