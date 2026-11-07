import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'fs'
import { join } from 'path'
import { CASCADE_CHILDREN } from '../../lib/audit/cascade'

test('CASCADE_CHILDREN matches every onDelete: Cascade relation in the schema', () => {
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8')
  const found: string[] = []
  let model = ''
  for (const line of schema.split('\n')) {
    const m = /^model (\w+)/.exec(line)
    if (m) model = m[1]
    const r = /^\s*\w+\s+(\w+)\s+@relation\(fields: \[(\w+)\].*onDelete: Cascade/.exec(line)
    if (r) found.push(`${r[1]}>${model}.${r[2]}`)
  }
  const mapped = Object.entries(CASCADE_CHILDREN).flatMap(([p, cs]) => cs.map((c) => `${p}>${c.model}.${c.fk}`))
  assert.deepEqual(mapped.sort(), found.sort())
})
