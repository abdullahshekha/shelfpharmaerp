import { prisma, check, makeQaCustomer, portalLogin, api, ensureQaOffer, staffCookie, cleanupQa } from './qa-helpers'

const putOrder = (cookie: string, body: object) => api('/api/portal/order', cookie, { method: 'PUT', body: JSON.stringify(body) })

async function main() {
  try {
    const offer = await ensureQaOffer()
    const { retailer, username, password } = await makeQaCustomer({ customerType: 'QA-Type-Orders' })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: retailer.id } })
    const cookie = (await portalLogin(username, password)).cookie!
    const M = offer.medicineId

    // nothing open yet
    check('no open order initially', (await (await api('/api/portal/order', cookie)).json()).data === null)

    // tampered / invalid carts
    check('foreign medicineId -> 400', (await putOrder(cookie, { orderId: null, items: [{ medicineId: 'not-on-my-list', quantity: 1 }] })).status === 400)
    for (const q of [-1, 1.5, 10000, '5']) {
      check(`quantity ${JSON.stringify(q)} -> 400`, (await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: q }] })).status === 400)
    }
    check('duplicate ids -> 400', (await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 1 }, { medicineId: M, quantity: 2 }] })).status === 400)
    check('empty cart with no order -> 400', (await putOrder(cookie, { orderId: null, items: [] })).status === 400)
    check('no order was created by the bad requests', (await prisma.order.count({ where: { retailerId: retailer.id } })) === 0)

    // place: client-supplied price is ignored; priced server-side (T.P. 100, 10% off)
    let r = await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 5, unitPrice: 0.01, offerPercent: 99 }] })
    let j = await r.json()
    check('place order 200', r.status === 200)
    check('priced server-side: 5 x 100 x 0.9 = 450', j.data?.totalAmount === 450 && j.data.items[0].unitPrice === 100 && j.data.items[0].offerPercent === 10, JSON.stringify(j.data))
    const db = await prisma.order.findFirst({ where: { retailerId: retailer.id }, include: { items: true } })
    check('stored PENDING / OFFER_LIST / MRP snapshot', db?.status === 'PENDING' && db.source === 'OFFER_LIST' && Number(db.items[0].mrp) === 130 && Number(db.totalAmount) === 450)
    const orderId = j.data.id as string

    // GET returns it; the offer-list page can pre-fill from this
    j = await (await api('/api/portal/order', cookie)).json()
    check('open order returned', j.data?.id === orderId && j.data.items[0].quantity === 5)

    // update replaces lines in the SAME order (no second order, no double-adding)
    r = await putOrder(cookie, { orderId, items: [{ medicineId: M, quantity: 8 }] })
    j = await r.json()
    check('update keeps same order, qty replaced (8 x 90 = 720)', r.status === 200 && j.data.id === orderId && j.data.items.length === 1 && j.data.totalAmount === 720)
    check('still exactly one order', (await prisma.order.count({ where: { retailerId: retailer.id } })) === 1)

    // second tab / device that thinks there is no open order
    r = await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })
    check('orderId null while an order is open -> 409', r.status === 409)
    check('…and nothing changed', Number((await prisma.order.findUnique({ where: { id: orderId } }))?.totalAmount) === 720)

    // a staff-created PENDING order for this customer is never touched
    const staffOrder = await prisma.order.create({ data: { orderNumber: `QA-STAFF-${Date.now()}`, retailerId: retailer.id, status: 'PENDING', source: 'MANUAL', totalAmount: 1 } })
    await putOrder(cookie, { orderId, items: [{ medicineId: M, quantity: 2 }] })
    check('staff MANUAL pending order untouched', (await prisma.order.findUnique({ where: { id: staffOrder.id } }))?.totalAmount.toString() === '1')

    // history shows both statuses
    j = await (await api('/api/portal/orders', cookie)).json()
    const hid = (j.data as { id: string }[]).map(o => o.id)
    check('history lists both orders, newer (staff) first', hid.length === 2 && hid[0] === staffOrder.id && hid[1] === orderId, JSON.stringify(hid))

    // editing a staff-created order via the portal is refused and leaves it intact
    r = await putOrder(cookie, { orderId: staffOrder.id, items: [{ medicineId: M, quantity: 4 }] })
    check('PUT with a staff MANUAL order id -> 409', r.status === 409)
    const so = await prisma.order.findUnique({ where: { id: staffOrder.id }, include: { items: true } })
    check('staff order unchanged after refused edit', so?.totalAmount.toString() === '1' && so.items.length === 0)

    // staff confirmed the order after the customer loaded it (sequential, stale orderId) -> 409, edit not applied; next order starts fresh
    const conf = await api(`/api/orders/${orderId}/status`, staffCookie(), { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) })
    check('staff confirm ok', conf.status === 200)
    r = await putOrder(cookie, { orderId, items: [{ medicineId: M, quantity: 99 }] })
    check('edit after confirm -> 409', r.status === 409 && /updated by our team/i.test((await r.json()).error))
    check('confirmed order unchanged (2 x 90 = 180)', Number((await prisma.order.findUnique({ where: { id: orderId } }))?.totalAmount) === 180)
    check('no open order after confirm', (await (await api('/api/portal/order', cookie)).json()).data === null)
    r = await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 3 }] })
    j = await r.json()
    check('next order is a NEW order', r.status === 200 && j.data.id !== orderId && j.data.totalAmount === 270)
    const newId = j.data.id as string
    j = await (await api('/api/portal/orders', cookie)).json()
    const confirmed = j.data.find((o: { id: string }) => o.id === orderId)
    check('history shows confirmed status, invoice total and delivery date', confirmed?.status === 'CONFIRMED' && confirmed.invoiceTotal === 180 && !!confirmed.scheduledDate, JSON.stringify(confirmed))

    // zero-out a line, then clear the cart deletes the open order
    r = await putOrder(cookie, { orderId: newId, items: [{ medicineId: M, quantity: 0 }] })
    check('clearing the cart -> 200 with data null', r.status === 200 && (await r.json()).data === null)
    check('open order deleted', (await prisma.order.findUnique({ where: { id: newId } })) === null)

    // another customer cannot touch this customer's order
    const other = await makeQaCustomer({ customerType: 'QA-Type-Orders' })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: other.retailer.id } })
    const oc = (await portalLogin(other.username, other.password)).cookie!
    const mine = (await (await putOrder(cookie, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })).json()).data.id as string
    check("other customer's PUT with my orderId -> 409, my order intact", (await putOrder(oc, { orderId: mine, items: [{ medicineId: M, quantity: 7 }] })).status === 409 && Number((await prisma.order.findUnique({ where: { id: mine } }))?.totalAmount) === 90)

    // concurrent creates for a customer with no open order: exactly one wins
    const racer = await makeQaCustomer({ customerType: 'QA-Type-Orders' })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: racer.retailer.id } })
    const rc = (await portalLogin(racer.username, racer.password)).cookie!
    const rs = await Promise.all(Array.from({ length: 6 }, () => putOrder(rc, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })))
    const codes = rs.map(x => x.status)
    check('6 parallel creates: exactly one 200, rest 409', codes.filter(c => c === 200).length === 1 && codes.filter(c => c === 409).length === 5, JSON.stringify(codes))
    check('exactly one open order in DB', (await prisma.order.count({ where: { retailerId: racer.retailer.id, status: 'PENDING', source: 'OFFER_LIST' } })) === 1)

    // confirm-vs-edit race: invoice must never disagree with the lines
    const rr = await makeQaCustomer({ customerType: 'QA-Type-Orders' })
    await prisma.offerListCustomer.create({ data: { offerListId: offer.listId, retailerId: rr.retailer.id } })
    const rrc = (await portalLogin(rr.username, rr.password)).cookie!
    for (let i = 0; i < 5; i++) {
      const oid = (await (await putOrder(rrc, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })).json()).data.id as string
      const [ur, sr] = await Promise.all([
        putOrder(rrc, { orderId: oid, items: [{ medicineId: M, quantity: 7 }] }),
        api(`/api/orders/${oid}/status`, staffCookie(), { method: 'PUT', body: JSON.stringify({ status: 'CONFIRMED' }) }),
      ])
      const o = await prisma.order.findUnique({ where: { id: oid }, include: { items: true, invoice: true } })
      const sum = o!.items.reduce((s, it) => s + Number(it.lineTotal), 0)
      check(`race ${i}: update 200/409 (never 500), staff ${sr.status}, CONFIRMED`, (ur.status === 200 || ur.status === 409) && o?.status === 'CONFIRMED', `update=${ur.status} staff=${sr.status}`)
      check(`race ${i}: invoice subtotal == order total == sum of lines`, !!o?.invoice && Number(o.invoice.subtotal) === Number(o.totalAmount) && Number(o.totalAmount) === sum, `inv=${o?.invoice?.subtotal} total=${o?.totalAmount} sum=${sum}`)
    }

    // unauthenticated + no entitlement
    check('PUT without cookie -> 401', (await fetch('http://localhost:3100/api/portal/order', { method: 'PUT', headers: { 'content-type': 'application/json' }, body: '{}' })).status === 401)
    const nobody = await makeQaCustomer({ customerType: 'QA-Unentitled' })
    const nc = (await portalLogin(nobody.username, nobody.password)).cookie!
    check('customer without an offer list cannot order (400)', (await putOrder(nc, { orderId: null, items: [{ medicineId: M, quantity: 1 }] })).status === 400)
  } finally {
    await cleanupQa()
    console.log('cleanup done')
    await prisma.$disconnect()
  }
}
main().catch(e => { console.error(e); process.exit(1) })
