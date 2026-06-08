import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'

export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const id = searchParams.get('id')

  // If no ID, use active list
  const list = id
    ? await prisma.offerList.findUnique({ where: { id }, include: { items: { include: { medicine: { include: { manufacturer: { select: { name: true } } } } } } } })
    : await prisma.offerList.findFirst({ where: { isActive: true }, include: { items: { include: { medicine: { include: { manufacturer: { select: { name: true } } } } } } } })

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
    itemRows += `<tr class="heading"><td colspan="8" align="center" style="background-color:#FFA500; color: white; font-weight: bolder;"><b>${mfg}</b></td></tr>\n`
    for (const item of byMfg.get(mfg)!) {
      rowIndex++
      const offerDisplay = Number(item.offerPercent) > 0 ? `${Number(item.offerPercent).toFixed(2)}  %` : ''
      const bonusDisplay = item.bonusQty > 0 ? String(item.bonusQty) : (item.medicine.bonusQty ?? '')
      const price = Number(item.specialPrice ?? item.medicine.tradePrice).toFixed(2)
      itemRows += `<tr class="item">
  <td align="center">${item.medicine.code}</td>
  <td style="text-align: left;">${item.medicine.name}</td>
  <td align="center"><input type="number" min="0" max="1000" style="font-size:20px; font-weight:bold;" placeholder="Qty" id="nameid${rowIndex}"></td>
  <td align="center">${offerDisplay}</td>
  <td align="center">${bonusDisplay}</td>
  <td align="center">${price}</td>
</tr>\n`
    }
  }

  const html = `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8" />
<script src="https://ajax.googleapis.com/ajax/libs/jquery/3.6.1/jquery.min.js"></script>
<script>
$(document).ready(function(){
  $("#myinputs").on("keyup", function() {
    var value = $(this).val().toLowerCase();
    $("#myTable tr.item").each(function() {
      $(this).toggle($(this).text().toLowerCase().indexOf(value) > -1);
    });
    $("#myTable tr.heading").each(function() {
      var next = $(this).nextUntil(".heading", ".item:visible");
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
<title>OFFER LIST - ${list.listNumber}</title>
<style>
@media print {
  .no-print { display: none !important; }
  .invoice-box table tr.item input { display: none; }
  body { font-size: 14px; }
}
.invoice-box {max-width:800px;margin:auto;padding:30px;border:1px solid;font-size:16px;line-height:24px;font-family:"Helvetica Neue","Helvetica",Helvetica,Arial,sans-serif;color:#555;}
h1 {padding:30px;}
.invoice-box table {width:100%;line-height:inherit;text-align:left;}
.invoice-box table td {padding:5px;vertical-align:top;}
.invoice-box table tr td:nth-child(2) {text-align:right;}
.invoice-box table tr.top table td {padding-bottom:20px;}
.invoice-box table tr.top table td.title {font-size:35px;line-height:35px;color:#333;}
.invoice-box table tr.heading td {border-bottom:1px solid #ddd;font-weight:900;color:white;font-size:24px;}
.invoice-box table tr.heading2 td {border-bottom:2px solid #ddd;font-weight:900;color:white;font-size:20px;background-color:#FFA500;}
.invoice-box table tr.heading3 td {border-bottom:2px solid #ddd;font-weight:900;font-size:24px;}
.invoice-box table tr.item td {border-bottom:1px solid #eee;font-weight:600;font-family:Tahoma,"Helvetica Neue","Helvetica",Helvetica,Arial,sans-serif;font-size:22px;}
.invoice-box table tr.item.last td {border-bottom:none;}
.item {font-weight:600;font-family:Tahoma,"Helvetica Neue","Helvetica",Helvetica,Arial,sans-serif;font-size:22px;color:#555;transition:color 0.4s;border:rgb(197,103,103) 2px solid;}
.item:hover {background-color:#FFA500;font-weight:900;font-size:36px;color:white;}
#myinputs {width:75%;font-size:30px;border:1px solid #000;font-weight:600;text-align:left;color:rgb(48,48,56);}
#cstname {width:75%;font-size:30px;font-family:Tahoma,"Helvetica Neue","Helvetica",Helvetica,Arial,sans-serif;border:2px solid #000;font-weight:600;}
#myinputs:focus {width:75%;font-size:30px;border:3px solid #000;font-weight:600;}
.mybtn {color:white;background-color:#008000;font-size:23px;width:150px;height:50px;border:none;cursor:pointer;margin-top:10px;}
.mybtn:hover {background-color:#006600;}
</style>
</head>
<body>
<div class="invoice-box">
<table cellpadding="0" cellspacing="0" border="1">
<tr class="top"><td colspan="7"><table><tr><td style="text-align:center;">
  <h2 style="text-shadow:10px 10px 20px #FFA500;font-size:35px;">Shelf Pharma</h2>
  <h6 style="font-size:20px;">PECHS Ext. Block 6, Karachi<br>Whatsapp No.= 0330-77SHELF (0330-7774353)</h6>
</td></tr></table></td></tr>

<tr class="information"><td colspan="8"><table>
  <tr><td colspan="7" align="center" style="font-size:80px;font-weight:700;"><b>OFFER LIST</b></td></tr>
</table></td></tr>

<tr>
  <td style="font-size:30px;text-align:left;" colspan="3"><b>List No : </b>${list.listNumber}</td>
  <td style="font-size:26px;text-align:right;" colspan="4"><b>List Date</b> : ${dateStr}</td>
</tr>

<tr class="heading2">
  <td style="text-align:center;">CODE</td>
  <td style="text-align:center;">ITEM NAME</td>
  <td align="center">ORDER</td>
  <td align="center">OFFER</td>
  <td align="center">BONUS</td>
  <td align="center">T.P</td>
</tr>

<tr class="heading3 no-print"><td align="center" colspan="8">
  <center><h5>SEARCH ITEMS HERE<br>
  <input type="text" id="myinputs" placeholder="SEARCH ITEMS HERE"></h5></center>
</td></tr>

<tr class="no-print"><td colspan="8" style="padding:8px;">
  <input type="text" id="cstname" placeholder="Your Name / Shop Name">
</td></tr>

<tbody id="myTable">
${itemRows}
</tbody>

<tr class="no-print"><td colspan="8" align="center" style="padding:16px;">
  <button class="mybtn" id="submitOrder">SUBMIT ORDER</button>
  &nbsp;&nbsp;
  <button class="mybtn" onclick="window.print()" style="background-color:#0d6efd;">PRINT</button>
</td></tr>

</table>
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
