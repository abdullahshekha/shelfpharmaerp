import { test } from 'node:test'
import assert from 'node:assert/strict'
import { csvCell } from '../../lib/utils/csv'

test('formula-looking strings get an apostrophe prefix', () => {
  for (const v of ['=SUM(A1)', '+1', '-1+2', '@cmd', '\tx', '\rx']) assert.ok(csvCell(v).startsWith(`"'`), v)
  assert.equal(csvCell('=1+1'), `"'=1+1"`)
})

test('numbers (including negative) and normal text are untouched', () => {
  assert.equal(csvCell(-12.5), '"-12.5"')
  assert.equal(csvCell(0), '"0"')
  assert.equal(csvCell('Panadol'), '"Panadol"')
  assert.equal(csvCell(null), '""')
})

test('quotes are still escaped', () => {
  assert.equal(csvCell('a "b"'), '"a ""b"""')
})
