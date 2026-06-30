import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSnapshot } from '../lib/snapshot.mjs'

const result = {
  rows: [
    {
      id: 'p1',
      name: 'Jane Doe',
      email: 'jane.login@example.com',
      loginEmail: 'jane.login@example.com',
      contactEmail: null,
      open: 2,
      done: 1,
      total: 3,
      projects: [{ id: 'proj-a', name: 'High-Code', open: 2, done: 1, total: 3 }],
    },
  ],
  totals: { people: 1, open: 2, done: 1, total: 3 },
  unassigned: 0,
  cancelled: 1,
}

test('snapshot carries id, both email sources, and per-person projects', () => {
  const snap = buildSnapshot(result, { generatedAt: new Date('2026-06-30T01:00:00.000Z') })
  assert.equal(snap.source, 'watchog')
  assert.equal(snap.generatedAt, '2026-06-30T01:00:00.000Z')
  assert.equal(snap.people.length, 1)
  assert.equal(snap.people[0].id, 'p1')
  assert.equal(snap.people[0].email, 'jane.login@example.com')
  assert.equal(snap.people[0].loginEmail, 'jane.login@example.com')
  assert.equal(snap.people[0].contactEmail, null)
  assert.deepEqual(snap.people[0].projects, [
    { id: 'proj-a', name: 'High-Code', open: 2, done: 1, total: 3 },
  ])
  assert.deepEqual(snap.totals, { people: 1, open: 2, done: 1, total: 3 })
  assert.equal(snap.cancelled, 1)
})

test('missing emails and projects degrade to null/empty, not crash', () => {
  const snap = buildSnapshot({
    rows: [{ id: 'p2', name: 'John Smith', open: 1, done: 0, total: 1 }],
    totals: { people: 1, open: 1, done: 0, total: 1 },
    unassigned: 0,
    cancelled: 0,
  })
  assert.equal(snap.people[0].email, null)
  assert.equal(snap.people[0].loginEmail, null)
  assert.equal(snap.people[0].contactEmail, null)
  assert.deepEqual(snap.people[0].projects, [])
  assert.equal(snap.generatedAt, null) // no generatedAt -> null, not a throw
})

test('empty result yields empty people and zeroed totals', () => {
  const snap = buildSnapshot(
    { rows: [], totals: { people: 0, open: 0, done: 0, total: 0 }, unassigned: 0, cancelled: 0 },
    { generatedAt: new Date('2026-06-30T01:00:00.000Z') },
  )
  assert.deepEqual(snap.people, [])
  assert.equal(snap.totals.people, 0)
})
