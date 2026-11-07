import test from 'node:test'
import assert from 'node:assert/strict'
import { readdirSync, readFileSync, statSync } from 'fs'
import { join, relative } from 'path'

// The audit extension refuses audited writes inside an array `$transaction([...])` (it cannot add the audit
// insert to a batch). Any array-form call (literal array, `.map(...)` result, a variable) therefore has to be an
// interactive transaction instead. This scans app/ and lib/ so the defect class cannot come back unnoticed.

const ROOT = join(__dirname, '../..')

// Allowed call sites, each justified:
// - lib/audit/extension.ts: the `$transaction` override itself forwards a non-function argument to Prisma
//   unchanged; the hook then refuses any audited write in it (fail closed). It is not a business transaction.
const ALLOW = new Set(['lib/audit/extension.ts'])

// After `$transaction(` the first argument must be a callback: `async ...`, `function`, `(tx) =>`, `(tx: T) =>`, `tx =>`.
const CALLBACK_START = /^(async\b|function\b|\(\s*\w*\s*(:[^)]*)?\)\s*=>|\w+\s*=>)/

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name)
    if (statSync(p).isDirectory()) return files(p)
    return /\.(ts|tsx|js|mjs)$/.test(name) ? [p] : []
  })
}

function stripComments(src: string) {
  return src.replace(/\/\*[\s\S]*?\*\//g, (c) => c.replace(/[^\n]/g, '')) // keep line numbers.replace(/(^|[^:])\/\/.*$/gm, '$1')
}

test('no array-form $transaction in app/ or lib/', () => {
  const offenders: string[] = []
  for (const file of [...files(join(ROOT, 'app')), ...files(join(ROOT, 'lib'))]) {
    const rel = relative(ROOT, file).replace(/\\/g, '/')
    if (ALLOW.has(rel)) continue
    const src = stripComments(readFileSync(file, 'utf8'))
    const re = /\$transaction\(/g
    let m: RegExpExecArray | null
    while ((m = re.exec(src))) {
      const rest = src.slice(m.index + m[0].length).replace(/^\s+/, '')
      if (!CALLBACK_START.test(rest)) {
        const line = src.slice(0, m.index).split('\n').length
        offenders.push(`${rel}:${line}: $transaction(${rest.slice(0, 40).replace(/\s+/g, ' ')}...`)
      }
    }
  }
  assert.deepEqual(offenders, [], `array-form $transaction found (use prisma.$transaction(async (tx) => ...)):\n${offenders.join('\n')}`)
})

test('the detector catches the array forms', () => {
  for (const bad of ['[a, b]', 'items.map((i) => x)', 'ops)', 'ops, { timeout: 1 })']) assert.equal(CALLBACK_START.test(bad), false, bad)
  for (const ok of ['async (tx) => {', '(tx) => tx.a.b()', '(tx: Tx) => x', 'tx => x', 'function (tx) {}']) assert.equal(CALLBACK_START.test(ok), true, ok)
})
