import { test } from 'node:test'
import assert from 'node:assert/strict'
import { personsDirectory, personEntry, overview, projectSummary } from '../lib/views.mjs'
import { handlePersons } from '../api/persons.mjs'
import { handleSummary } from '../api/summary.mjs'
import { handleProjects } from '../api/projects.mjs'

// Synthetic roster: two people sharing project proj-a; one also on proj-b.
const snapshot = {
  generatedAt: '2026-06-30T01:00:00.000Z',
  source: 'watchog',
  people: [
    {
      id: 'p1',
      name: 'Bob Brown',
      email: 'bob@example.com',
      loginEmail: 'bob@example.com',
      contactEmail: null,
      open: 5,
      done: 2,
      total: 7,
      projects: [
        { id: 'proj-a', name: 'Apollo', open: 3, done: 1, total: 4 },
        { id: 'proj-b', name: 'Borealis', open: 2, done: 1, total: 3 },
      ],
    },
    {
      id: 'p2',
      name: 'Amy Adams',
      email: 'amy@example.com',
      loginEmail: 'amy@example.com',
      contactEmail: 'amy.alt@example.com',
      open: 4,
      done: 0,
      total: 4,
      projects: [{ id: 'proj-a', name: 'Apollo', open: 4, done: 0, total: 4 }],
    },
  ],
  totals: { people: 2, total: 11, done: 2, open: 9 },
  unassigned: 3,
  cancelled: 1,
}

const catalog = {
  generatedAt: '2026-06-30T01:00:00.000Z',
  source: 'watchog',
  projects: [
    { id: 'proj-a', name: 'Apollo', identifier: 'APO' },
    { id: 'proj-b', name: 'Borealis', identifier: 'BOR' },
  ],
}

// --- pure reshapers ------------------------------------------------------

test('personsDirectory lists identity only, sorted by name', () => {
  const d = personsDirectory(snapshot)
  assert.deepEqual(d.persons.map((p) => p.name), ['Amy Adams', 'Bob Brown'])
  assert.equal(d.persons[0].email, 'amy@example.com')
  assert.equal(d.persons[0].contactEmail, 'amy.alt@example.com')
  assert.equal(d.persons[0].open, undefined) // no card counts in the directory
})

test('personEntry returns one identity or null', () => {
  assert.equal(personEntry(snapshot, 'p1').name, 'Bob Brown')
  assert.equal(personEntry(snapshot, 'nope'), null)
})

test('overview returns totals only', () => {
  const o = overview(snapshot)
  assert.deepEqual(o.totals, { people: 2, total: 11, done: 2, open: 9 })
  assert.equal(o.unassigned, 3)
  assert.equal(o.cancelled, 1)
  assert.equal(o.people, undefined) // no roster
})

test('projectSummary sums per-person counts for a shared project, sorted by open desc', () => {
  const ps = projectSummary(snapshot, catalog, 'proj-a')
  assert.equal(ps.name, 'Apollo')
  assert.equal(ps.identifier, 'APO')
  assert.deepEqual(ps.totals, { people: 2, total: 8, done: 1, open: 7 })
  assert.deepEqual(ps.people.map((p) => p.name), ['Amy Adams', 'Bob Brown']) // Amy open 4 > Bob open 3
})

test('projectSummary for a single-member project', () => {
  const ps = projectSummary(snapshot, catalog, 'proj-b')
  assert.deepEqual(ps.totals, { people: 1, total: 3, done: 1, open: 2 })
  assert.equal(ps.people[0].id, 'p1')
})

test('projectSummary returns null for an id in neither catalog nor roster', () => {
  assert.equal(projectSummary(snapshot, catalog, 'ghost'), null)
})

test('projectSummary resolves a catalog project with no cards to empty totals (not 404)', () => {
  const cat = { projects: [{ id: 'empty', name: 'Empty', identifier: 'EMP' }] }
  const ps = projectSummary(snapshot, cat, 'empty')
  assert.deepEqual(ps.totals, { people: 0, total: 0, done: 0, open: 0 })
  assert.equal(ps.name, 'Empty')
})

// --- handlers ------------------------------------------------------------

const token = 'secret'
const auth = `Bearer ${token}`
const fresh = Date.parse('2026-06-30T01:10:00.000Z')

test('GET /persons returns the directory, not stale', () => {
  const r = handlePersons({ method: 'GET', path: '/persons', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.stale, false)
  assert.equal(r.body.persons.length, 2)
})

test('GET /persons/{id} returns identity only', () => {
  const r = handlePersons({ method: 'GET', path: '/persons/p1', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.name, 'Bob Brown')
  assert.equal(r.body.open, undefined)
})

test('GET /persons/{id}/summary returns the full person object (counts + projects)', () => {
  const r = handlePersons({ method: 'GET', path: '/persons/p1/summary', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.open, 5)
  assert.equal(r.body.projects.length, 2)
})

test('GET /persons/{unknown} and /persons/{unknown}/summary are 404', () => {
  assert.equal(handlePersons({ method: 'GET', path: '/persons/nope', authHeader: auth }, { snapshot, token, now: fresh }).status, 404)
  assert.equal(handlePersons({ method: 'GET', path: '/persons/nope/summary', authHeader: auth }, { snapshot, token, now: fresh }).status, 404)
})

test('persons: 401 / 405 / 503 behave as siblings', () => {
  assert.equal(handlePersons({ method: 'GET', path: '/persons', authHeader: '' }, { snapshot, token, now: fresh }).status, 401)
  assert.equal(handlePersons({ method: 'POST', path: '/persons', authHeader: auth }, { snapshot, token, now: fresh }).status, 405)
  assert.equal(handlePersons({ method: 'GET', path: '/persons', authHeader: auth }, { snapshot: null, token, now: fresh }).status, 503)
})

test('GET /overview is served by handleSummary, totals only', () => {
  const r = handleSummary({ method: 'GET', path: '/overview', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.deepEqual(r.body.totals, { people: 2, total: 11, done: 2, open: 9 })
  assert.equal(r.body.people, undefined)
  assert.equal(r.body.stale, false)
})

test('GET /summary still returns the full roster (unchanged)', () => {
  const r = handleSummary({ method: 'GET', path: '/summary', authHeader: auth }, { snapshot, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.people.length, 2)
})

test('GET /projects/{id}/summary derives per-project counts from the roster', () => {
  const r = handleProjects(
    { method: 'GET', path: '/projects/proj-a/summary', authHeader: auth },
    { doc: catalog, summary: snapshot, token, now: fresh },
  )
  assert.equal(r.status, 200)
  assert.equal(r.body.projectId, 'proj-a')
  assert.deepEqual(r.body.totals, { people: 2, total: 8, done: 1, open: 7 })
  assert.equal(r.body.people.length, 2)
})

test('GET /projects/{unknown}/summary is 404; missing roster is 503', () => {
  assert.equal(
    handleProjects({ method: 'GET', path: '/projects/ghost/summary', authHeader: auth }, { doc: catalog, summary: snapshot, token, now: fresh }).status,
    404,
  )
  assert.equal(
    handleProjects({ method: 'GET', path: '/projects/proj-a/summary', authHeader: auth }, { doc: catalog, summary: null, token, now: fresh }).status,
    503,
  )
})

test('an /api prefix and querystring still route /projects/{id}/summary', () => {
  const r = handleProjects(
    { method: 'GET', path: '/api/projects/proj-b/summary?x=1', authHeader: auth },
    { doc: catalog, summary: snapshot, token, now: fresh },
  )
  assert.equal(r.status, 200)
  assert.equal(r.body.projectId, 'proj-b')
})
