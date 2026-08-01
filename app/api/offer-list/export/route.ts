import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getEffectivePrice } from '@/lib/utils/pricing'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  const medicineInclude = {
    manufacturer: { select: { name: true } },
    batches: { select: { currentQty: true, expiryDate: true, tradePrice: true, mrp: true } },
  }

  // If no ID, use active list
  const list = id
    ? await prisma.offerList.findUnique({ where: { id }, include: { items: { include: { medicine: { include: medicineInclude } } } } })
    : await prisma.offerList.findFirst({ where: { isActive: true }, include: { items: { include: { medicine: { include: medicineInclude } } } } })

  if (!list) {
    return new NextResponse('No active offer list found', { status: 404 })
  }

  // Group items by manufacturer
  const byMfg = new Map<string, typeof list.items>()
  for (const item of list.items) {
    const mfg = item.medicine.manufacturer.name
    if (!byMfg.has(mfg)) byMfg.set(mfg, [])
    byMfg.get(mfg)!.push(item)
  }
  const sortedMfgs = Array.from(byMfg.keys()).sort()

  const listDate = new Date(list.listDate)
  const dateStr = `${String(listDate.getMonth() + 1).padStart(2, '0')}/${String(listDate.getDate()).padStart(2, '0')}/${String(listDate.getFullYear()).slice(-2)}`

  let rowIndex = 0
  let itemRows = ''
  for (const mfg of sortedMfgs) {
    itemRows += `<tr class="mfg-row"><td colspan="6">${mfg}</td></tr>\n`
    for (const item of byMfg.get(mfg)!) {
      rowIndex++
      const maxOffDisplay = Number(item.offerPercent) > 0 ? `${Number(item.offerPercent).toFixed(2)}%` : '—'
      const bonusDisplay = item.bonusQty > 0 ? String(item.bonusQty) : (item.medicine.bonusQty ?? '—')
      const effectiveTradePrice = getEffectivePrice(item.medicine.batches).tradePrice
      const price = (item.specialPrice != null ? Number(item.specialPrice) : effectiveTradePrice ?? 0).toFixed(2)
      itemRows += `<tr class="item">
  <td class="col-code">${item.medicine.code}</td>
  <td class="col-name">${item.medicine.name}</td>
  <td class="col-order"><input type="number" min="0" max="1000" placeholder="Qty" id="nameid${rowIndex}"></td>
  <td class="col-num">${maxOffDisplay}</td>
  <td class="col-num">${bonusDisplay}</td>
  <td class="col-num col-price">Rs. ${price}</td>
</tr>\n`
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">
<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.1/jquery.min.js"></script>
<script>
$(document).ready(function(){
  $("#myinputs").on("keyup", function() {
    var value = $(this).val().toLowerCase();
    $("#myTable tr.item").each(function() {
      $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
    });
    $("#myTable tr.mfg-row").each(function() {
      var next = $(this).nextUntil(".mfg-row", ".item:visible");
      $(this).toggle(next.length > 0);
    });
  });

  $("#submitOrder").on("click", function() {
    var items = [];
    $("#myTable tr.item").each(function() {
      var qty = $(this).find("input[type=number]").val();
      if (qty && parseInt(qty) > 0) {
        items.push({
          code: $(this).find("td:first").text().trim(),
          name: $(this).find("td:nth-child(2)").text().trim(),
          qty: parseInt(qty)
        });
      }
    });
    if (items.length === 0) { alert("Please enter at least one quantity."); return; }
    var name = $("#cstname").val();
    if (!name) { alert("Please enter your name / shop name."); return; }
    alert("Order submitted for " + items.length + " items. Staff will contact you shortly.");
    console.log("Order:", JSON.stringify({ customer: name, items: items, listNo: "${list.listNumber}" }));
  });
});
</script>
<title>Offer List — ${list.listNumber}</title>
<style>
  :root {
    --navy: #0f172a;
    --blue: #2563eb;
    --blue-dark: #1d4ed8;
    --slate-50: #f8fafc;
    --slate-100: #f1f5f9;
    --slate-200: #e2e8f0;
    --slate-500: #64748b;
    --slate-600: #475569;
    --slate-700: #334155;
  }

  * { box-sizing: border-box; }

  body {
    margin: 0;
    padding: 32px 16px;
    background: var(--slate-50);
    font-family: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Arial, sans-serif;
    color: var(--slate-700);
  }

  .sheet {
    max-width: 960px;
    margin: 0 auto;
    background: #fff;
    border: 1px solid var(--slate-200);
    border-radius: 16px;
    overflow: hidden;
    box-shadow: 0 1px 3px rgba(15, 23, 42, 0.08);
  }

  .brand-bar {
    background: var(--navy);
    color: #fff;
    padding: 24px 32px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 8px;
  }

  .brand-bar h1 {
    margin: 0;
    font-size: 22px;
    font-weight: 800;
    letter-spacing: -0.02em;
  }

  .brand-bar p {
    margin: 4px 0 0;
    font-size: 13px;
    color: #cbd5e1;
  }

  .title-row {
    padding: 24px 32px 8px;
    display: flex;
    align-items: center;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 12px;
  }

  .title-row h2 {
    margin: 0;
    font-size: 26px;
    font-weight: 800;
    color: var(--navy);
    letter-spacing: -0.02em;
  }

  .meta {
    text-align: right;
    font-size: 13px;
    color: var(--slate-500);
  }

  .meta b { color: var(--slate-700); }

  .controls {
    padding: 8px 32px 20px;
    display: flex;
    gap: 12px;
    flex-wrap: wrap;
  }

  .controls input[type="text"] {
    flex: 1;
    min-width: 200px;
    padding: 10px 14px;
    border: 1px solid var(--slate-200);
    border-radius: 10px;
    font-size: 14px;
    font-family: inherit;
    background: var(--slate-50);
  }

  .controls input[type="text"]:focus {
    outline: none;
    border-color: var(--blue);
    background: #fff;
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }

  table { width: 100%; border-collapse: collapse; }

  thead th {
    text-align: left;
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: var(--slate-500);
    background: var(--slate-100);
    padding: 10px 12px;
    border-top: 1px solid var(--slate-200);
    border-bottom: 1px solid var(--slate-200);
  }

  tr.mfg-row td {
    background: var(--navy);
    color: #fff;
    font-weight: 700;
    font-size: 13px;
    letter-spacing: 0.02em;
    padding: 8px 12px;
  }

  tr.item td {
    padding: 10px 12px;
    border-bottom: 1px solid var(--slate-100);
    font-size: 14px;
  }

  tr.item:hover td { background: #eff6ff; }

  .col-code { font-family: ui-monospace, Menlo, monospace; font-size: 12px; color: var(--slate-500); white-space: nowrap; }
  .col-name { font-weight: 600; color: var(--navy); }
  .col-num { text-align: right; white-space: nowrap; }
  .col-price { font-weight: 700; color: var(--navy); }
  .col-order { text-align: center; width: 90px; }

  .col-order input {
    width: 72px;
    padding: 6px 8px;
    text-align: center;
    border: 1px solid var(--slate-200);
    border-radius: 8px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
  }

  .col-order input:focus {
    outline: none;
    border-color: var(--blue);
    box-shadow: 0 0 0 3px rgba(37, 99, 235, 0.12);
  }

  .actions {
    padding: 24px 32px 32px;
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 12px;
  }

  .btn {
    border: none;
    border-radius: 10px;
    padding: 12px 24px;
    font-size: 14px;
    font-weight: 600;
    font-family: inherit;
    cursor: pointer;
    transition: background-color 0.15s;
  }

  .btn-primary { background: var(--blue); color: #fff; }
  .btn-primary:hover { background: var(--blue-dark); }
  .btn-secondary { background: var(--slate-100); color: var(--slate-700); }
  .btn-secondary:hover { background: var(--slate-200); }

  @media print {
    body { background: #fff; padding: 0; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .sheet { border: none; border-radius: 0; box-shadow: none; max-width: 100%; }
    .no-print { display: none !important; }
    tr.item input { display: none; }
    tr.mfg-row td, thead th { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  }
</style>
</head>
<body>
<div class="sheet">
  <div class="brand-bar">
    <div>
      <h1>ShelfPharma</h1>
      <p>PECHS Ext. Block 6, Karachi &middot; WhatsApp 0330-7774353</p>
    </div>
  </div>

  <div class="title-row">
    <h2>Offer List</h2>
    <div class="meta">
      <div><b>List No:</b> ${list.listNumber}</div>
      <div><b>List Date:</b> ${dateStr}</div>
    </div>
  </div>

  <div class="controls no-print">
    <input type="text" id="myinputs" placeholder="Search medicines...">
    <input type="text" id="cstname" placeholder="Your Name / Shop Name">
  </div>

  <table>
    <thead>
      <tr>
        <th>Code</th>
        <th>Item Name</th>
        <th style="text-align:center;">Order</th>
        <th style="text-align:right;">Max Off %</th>
        <th style="text-align:right;">Bonus</th>
        <th style="text-align:right;">T.P</th>
      </tr>
    </thead>
    <tbody id="myTable">
${itemRows}
    </tbody>
  </table>

  <div class="actions no-print">
    <button class="btn btn-primary" id="submitOrder">Submit Order</button>
    <button class="btn btn-secondary" onclick="window.print()">Print</button>
  </div>
</div>
</body>
</html>`

  return new NextResponse(html, {
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Content-Disposition': `inline; filename="OfferList-${list.listNumber}.html"`,
    },
  })
}
