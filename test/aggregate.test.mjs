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
const projectNameById = new Map([
  ['proj-a', 'High-Code'],
  ['proj-b', 'OutSystems'],
])
const loginEmailById = new Map([['p1', 'jane.login@example.com']])
const contactEmailById = new Map([['p2', 'john.contact@example.com']])

test('done cards count as done, open cards as open', () => {
  const issues = [
    { status: 's-done', assignee: 'p1' },
    { status: 's-progress', assignee: 'p1' },
    { status: 's-todo', assignee: 'p1' },
  ]
  const { rows } = aggregate(issues, statusStateById, personNameById)
  assert.equal(rows.length, 1)
  assert.deepEqual(rows[0], {
    id: 'p1',
    name: 'Jane Doe',
    email: null,
    loginEmail: null,
    contactEmail: null,
    total: 3,
    done: 1,
    open: 2,
    projects: [],
  })
})

test('cancelled cards are excluded from both done and open', () => {
  const issues = [
    { status: 's-cancelled', assignee: 'p1' },
    { status: 's-done', assignee: 'p1' },
  ]
  const { rows, cancelled } = aggregate(issues, statusStateById, personNameById)
  assert.equal(cancelled, 1)
  assert.deepEqual(rows[0], {
    id: 'p1',
    name: 'Jane Doe',
    email: null,
    loginEmail: null,
    contactEmail: null,
    total: 1,
    done: 1,
    open: 0,
    projects: [],
  })
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

test('email comes from login and contact sources separately, plus a merged field', () => {
  const issues = [
    { status: 's-todo', assignee: 'p1', space: 'proj-a' },
    { status: 's-todo', assignee: 'p2', space: 'proj-a' },
  ]
  const { rows } = aggregate(issues, statusStateById, personNameById, projectNameById, loginEmailById, contactEmailById)
  const jane = rows.find((r) => r.id === 'p1')
  const john = rows.find((r) => r.id === 'p2')
  // Jane: login email only
  assert.equal(jane.loginEmail, 'jane.login@example.com')
  assert.equal(jane.contactEmail, null)
  assert.equal(jane.email, 'jane.login@example.com')
  // John: contact-channel email only
  assert.equal(john.loginEmail, null)
  assert.equal(john.contactEmail, 'john.contact@example.com')
  assert.equal(john.email, 'john.contact@example.com')
})

test('merged `email` prefers the login source when both exist', () => {
  const issues = [{ status: 's-todo', assignee: 'p1', space: 'proj-a' }]
  const { rows } = aggregate(
    issues,
    statusStateById,
    personNameById,
    projectNameById,
    new Map([['p1', 'login@example.com']]),
    new Map([['p1', 'contact@example.com']]),
  )
  assert.equal(rows[0].loginEmail, 'login@example.com')
  assert.equal(rows[0].contactEmail, 'contact@example.com')
  assert.equal(rows[0].email, 'login@example.com')
})

test('per-project breakdown buckets a person’s cards by space, sorted by open desc', () => {
  const issues = [
    { status: 's-done', assignee: 'p1', space: 'proj-a' },
    { status: 's-progress', assignee: 'p1', space: 'proj-a' },
    { status: 's-todo', assignee: 'p1', space: 'proj-b' },
  ]
  const { rows } = aggregate(issues, statusStateById, personNameById, projectNameById, loginEmailById, contactEmailById)
  assert.deepEqual(rows[0].projects, [
    { id: 'proj-a', name: 'High-Code', open: 1, done: 1, total: 2 },
    { id: 'proj-b', name: 'OutSystems', open: 1, done: 0, total: 1 },
  ])
  // per-project counts reconcile with the person totals
  const sum = rows[0].projects.reduce((n, p) => n + p.total, 0)
  assert.equal(sum, rows[0].total)
})

test('cards with no space still count for the person but add no project row', () => {
  const issues = [{ status: 's-todo', assignee: 'p1', space: null }]
  const { rows } = aggregate(issues, statusStateById, personNameById, projectNameById, loginEmailById, contactEmailById)
  assert.equal(rows[0].total, 1)
  assert.deepEqual(rows[0].projects, [])
})
