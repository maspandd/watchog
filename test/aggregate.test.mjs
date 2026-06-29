import { test } from 'node:test'
import assert from 'node:assert/strict'
import { aggregate } from '../lib/aggregate.mjs'

const statusStateById = new Map([
  ['s-done', 'done'],
  ['s-cancelled', 'cancelled'],
  ['s-progress', 'open'],
  ['s-todo', 'open'],
])
const personNameById = new Map([
  ['p1', 'Jane Doe'],
  ['p2', 'John Smith'],
])

test('done cards count as done, open cards as open', () => {
  const issues = [
    { status: 's-done', assignee: 'p1' },
    { status: 's-progress', assignee: 'p1' },
    { status: 's-todo', assignee: 'p1' },
  ]
  const { rows } = aggregate(issues, statusStateById, personNameById)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], { id: 'p1', name: 'Jane Doe', total: 3, done: 1, open: 2 })
})

test('cancelled cards are excluded from both done and open', () => {
  const issues = [
    { status: 's-cancelled', assignee: 'p1' },
    { status: 's-done', assignee: 'p1' },
  ]
  const { rows, cancelled } = aggregate(issues, statusStateById, personNameById)
  assert.equal(cancelled, 1)
  assert.deepEqual(rows[0], { id: 'p1', name: 'Jane Doe', total: 1, done: 1, open: 0 })
})

test('a person is aggregated across multiple projects into one row', () => {
  // same assignee, different projects (space is irrelevant to the count)
  const issues = [
    { status: 's-todo', assignee: 'p2' },
    { status: 's-progress', assignee: 'p2' },
  ]
  const { rows } = aggregate(issues, statusStateById, personNameById)
  assert.equal(rows.length, 1)
  assert.equal(rows[0].total, 2)
  assert.equal(rows[0].open, 2)
})

test('unassigned cards are tallied separately, not as a person', () => {
  const issues = [{ status: 's-todo', assignee: null }]
  const { rows, unassigned } = aggregate(issues, statusStateById, personNameById)
  assert.equal(rows.length, 0)
  assert.equal(unassigned, 1)
})

test('unknown status is treated as open (never silently dropped)', () => {
  const issues = [{ status: 's-mystery', assignee: 'p1' }]
  const { rows } = aggregate(issues, statusStateById, personNameById)
  assert.equal(rows[0].open, 1)
})

test('rows sort by open desc, then name', () => {
  const issues = [
    { status: 's-todo', assignee: 'p1' },
    { status: 's-todo', assignee: 'p2' },
    { status: 's-todo', assignee: 'p2' },
  ]
  const { rows } = aggregate(issues, statusStateById, personNameById)
  assert.equal(rows[0].id, 'p2') // 2 open
  assert.equal(rows[1].id, 'p1') // 1 open
})

test('empty input yields empty rows and zero totals', () => {
  const { rows, totals, unassigned, cancelled } = aggregate([], statusStateById, personNameById)
  assert.deepEqual(rows, [])
  assert.equal(unassigned, 0)
  assert.equal(cancelled, 0)
  assert.deepEqual(totals, { people: 0, total: 0, done: 0, open: 0 })
})
