import { test } from 'node:test'
import assert from 'node:assert/strict'
import { handleSummary } from '../api/summary.mjs'

const snapshot = {
  generatedAt: '2026-06-30T01:00:00.000Z',
  source: 'watchog',
  people: [
    {
      id: 'p1',
      name: 'Jane Doe',
      email: 'jane.login@example.com',
      loginEmail: 'jane.login@example.com',
      contactEmail: null,
      open: 2,
      done: 1,
      total: 3,
      projects: [],
    },
  ],
  totals: { people: 1, open: 2, done: 1, total: 3 },
  unassigned: 0,
  cancelled: 0,
}

const token = 'secret'
const auth = `Bearer ${token}`
const fresh = Date.parse('2026-06-30T01:10:00.000Z') // 10 min after generatedAt

test('GET /summary returns the full roster, not stale', () => {
  const r = handleSummary({ method: 'GET', path: '/summary', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.people.length, 1)
  assert.equal(r.body.stale, false)
})

test('GET /summary/{id} returns one person with both email sources', () => {
  const r = handleSummary({ method: 'GET', path: '/summary/p1', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.id, 'p1')
  assert.equal(r.body.email, 'jane.login@example.com')
  assert.equal(r.body.loginEmail, 'jane.login@example.com')
  assert.equal(r.body.contactEmail, null)
})

test('GET /summary/{unknown} is 404', () => {
  const r = handleSummary({ method: 'GET', path: '/summary/nope', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 404)
})

test('missing or wrong bearer token is 401', () => {
  assert.equal(handleSummary({ method: 'GET', path: '/summary', authHeader: '' }, { snapshot, token, now: fresh }).status, 401)
  assert.equal(handleSummary({ method: 'GET', path: '/summary', authHeader: 'Bearer nope' }, { snapshot, token, now: fresh }).status, 401)
})

test('non-GET is 405', () => {
  const r = handleSummary({ method: 'POST', path: '/summary', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 405)
})

test('no snapshot yet is 503', () => {
  const r = handleSummary({ method: 'GET', path: '/summary', authHeader: auth }, { snapshot: null, token, now: fresh })
  assert.equal(r.status, 503)
})

test('snapshot older than the staleness window is flagged stale', () => {
  const old = Date.parse('2026-06-30T03:00:00.000Z') // 2h after generatedAt
  const r = handleSummary({ method: 'GET', path: '/summary', authHeader: auth }, { snapshot, token, now: old })
  assert.equal(r.body.stale, true)
})

test('an /api prefix and a querystring still route correctly', () => {
  const r = handleSummary({ method: 'GET', path: '/api/summary?foo=1', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.people.length, 1)
})
