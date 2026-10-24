import test from 'node:test'
import assert from 'node:assert/strict'
import { nextGridCell } from '../../lib/ui/grid-enter'

const grid = [['a1', 'a2', 'a3'], ['b1', 'b2', 'b3']]

test('middle of a row goes to the next column', () => assert.equal(nextGridCell(grid, 0, 1), 'a3'))
test('last column goes to first column of next row', () => assert.equal(nextGridCell(grid, 0, 2), 'b1'))
test('last cell of the last row returns null', () => assert.equal(nextGridCell(grid, 1, 2), null))
test('skips empty rows', () => assert.equal(nextGridCell([['x'], [], ['y']], 0, 0), 'y'))
