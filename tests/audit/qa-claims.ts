/* eslint-disable @typescript-eslint/no-explicit-any */
// Live-DB QA (QA-prefixed Area only, removed in finally): a claim that matches nothing must not log an entry,
// a plain write still works through the re-entrancy guard. Run: AUDIT_ALLOW_PURGE=1 npx tsx tests/audit/qa-claims.ts
import { prisma, check } from '../portal/qa-helpers'

async function main() {
  const a = await prisma.area.create({ data: { name: 'QA Claim Area' } })
  try {
    const first = await prisma.area.updateMany({ where: { id: a.id, name: 'QA Claim Area' }, data: { name: 'QA Claim Area 2' } })
    const second = await prisma.area.updateMany({ where: { id: a.id, name: 'QA Claim Area' }, data: { name: 'QA Claim Area 2' } })
    const ups = await prisma.auditLog.findMany({ where: { model: 'Area', recordId: a.id, action: 'UPDATE' } })
    check('winning claim count 1, losing claim count 0', first.count === 1 && second.count === 0, `${first.count}/${second.count}`)
    check('exactly one UPDATE entry (loser logs nothing)', ups.length === 1, String(ups.length))
    const b = await prisma.area.create({ data: { name: 'QA Claim Area B' } })
    const d1 = await prisma.area.deleteMany({ where: { id: b.id } })
    const d2 = await prisma.area.deleteMany({ where: { id: b.id } })
    const dels = await prisma.auditLog.findMany({ where: { model: 'Area', recordId: b.id, action: 'DELETE' } })
    check('delete claim: one DELETE entry only', d1.count === 1 && d2.count === 0 && dels.length === 1, `${d1.count}/${d2.count}/${dels.length}`)
    await prisma.auditLog.deleteMany({ where: { model: 'Area', recordId: b.id } })
  } finally {
    await prisma.area.deleteMany({ where: { name: { startsWith: 'QA Claim' } } })
    await prisma.auditLog.deleteMany({ where: { model: 'Area', recordId: a.id } })
    const left = await prisma.area.count({ where: { name: { startsWith: 'QA Claim' } } })
    console.log('leftover areas:', left)
  }
}
main().then(() => process.exit(0)).catch((e) => { console.error(e); process.exit(1) })
