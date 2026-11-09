import test from 'node:test'
import assert from 'node:assert/strict'
import { reissueGuard } from '../../lib/audit/extension'

// Prisma queries are lazy thenables: the hook only runs when the result is awaited.
const lazy = (hook: () => void) => ({ then: (res: (v: unknown) => void) => { hook(); res(1) } }) as PromiseLike<unknown>

test('guard is visible to a hook that runs lazily inside run()', async () => {
  const g = reissueGuard()
  let seen: boolean | undefined
  await g.run(() => lazy(() => { seen = g.active() }))
  assert.equal(seen, true)
})

test('guard is off outside run()', async () => {
  const g = reissueGuard()
  assert.equal(g.active(), false)
  await g.run(() => lazy(() => {}))
  assert.equal(g.active(), false)
})
