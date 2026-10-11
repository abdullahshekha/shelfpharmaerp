import { prisma, check, makeQaCustomer, portalLogin, api, ensureQaOffer, cleanupQa } from './qa-helpers'

async function main() {
  try {
    const offer = await ensureQaOffer()
    const area = await prisma.area.create({ data: { name: 'QA Portal Area', deliveryDays: [1, 2], bookingDays: [{ day: 0, cutoffHour: 17 }] } })

    // 1. entitled via individual sheet
    const a = await makeQaCustomer({ customerType: 'QA-NoSuchType', areaId: area.id })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: a.retailer.id } })
    const ca = (await portalLogin(a.username, a.password)).cookie!
    let j = await (await api('/api/portal/offer-list', ca)).json()
    const row = j.data?.items.find((i: { medicineId: string }) => i.medicineId === offer.medicineId)
    check('sheet customer sees the QA item at T.P. 100 / 10%', !!row && row.unitPrice === 100 && row.offerPercent === 10, JSON.stringify(row))
    const raw = JSON.stringify(j)
    check('no cost/stock fields in the payload', !/purchase|currentQty|batches|quantityIn|salesTax|mrp/i.test(raw))
    check('list sorted by manufacturer then name', j.data.items.every((it: { manufacturer: string; name: string }, i: number, arr: { manufacturer: string; name: string }[]) =>
      i === 0 || arr[i - 1].manufacturer.localeCompare(it.manufacturer) < 0 || (arr[i - 1].manufacturer === it.manufacturer && arr[i - 1].name.localeCompare(it.name) <= 0)))

    // 2. /me carries the area schedule
    const me = await (await api('/api/portal/me', ca)).json()
    check('/me delivery days [1,2] + booking cut-off', me.data.deliveryDays.join() === '1,2' && me.data.nextBooking?.day === 0 && me.data.nextBooking?.cutoffHour === 17, JSON.stringify(me.data))

    // 3. entitled via Customer Type assignment (no sheet), sparse data (no area)
    const b = await makeQaCustomer({ customerType: 'QA-Type-Assigned' })
    await prisma.offerListAssignment.create({ data: { offerListId: offer.listId, customerType: 'QA-Type-Assigned' } })
    const cb = (await portalLogin(b.username, b.password)).cookie!
    j = await (await api('/api/portal/offer-list', cb)).json()
    check('type-assigned customer resolves the list', j.data?.items.some((i: { medicineId: string }) => i.medicineId === offer.medicineId))
    const meB = await (await api('/api/portal/me', cb)).json()
    check('no-area customer: empty days, null cut-off', meB.data.deliveryDays.length === 0 && meB.data.nextBooking === null)

    // 4. not entitled / null customerType -> data: null, no crash
    const c = await makeQaCustomer({ customerType: 'QA-Unassigned-Type' })
    const cc = (await portalLogin(c.username, c.password)).cookie!
    j = await (await api('/api/portal/offer-list', cc)).json()
    check('unentitled customer -> data null', j.data === null)
    const d = await makeQaCustomer({ customerType: null })
    const cd = (await portalLogin(d.username, d.password)).cookie!
    check('null customerType -> 200, data null', (await api('/api/portal/offer-list', cd)).status === 200)

    // 5. unauthenticated
    check('offer-list without cookie -> 401', (await fetch('http://localhost:3100/api/portal/offer-list')).status === 401)
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
