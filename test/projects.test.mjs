import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildProjects } from '../lib/projects.mjs'
import { handleProjects } from '../api/projects.mjs'

// --- builder -------------------------------------------------------------

const rawProjects = [
  {
    id: 'proj-z',
    name: 'Zephyr',
    identifier: 'ZEP',
    description: 'last alphabetically',
    private: true,
    archived: false,
    members: ['uuid-bob', 'uuid-amy'],
    owners: ['uuid-amy'],
  },
  {
    id: 'proj-a',
    name: 'Apollo',
    identifier: 'APO',
    description: '',
    members: ['uuid-amy', 'uuid-unknown'],
    owners: [],
  },
]

const maps = {
  personByUuid: new Map([
    ['uuid-amy', 'person-amy'],
    ['uuid-bob', 'person-bob'],
  ]),
  personNameById: new Map([
    ['person-amy', 'Amy Adams'],
    ['person-bob', 'Bob Brown'],
  ]),
  loginEmailById: new Map([['person-amy', 'amy@example.com']]),
  contactEmailById: new Map([['person-bob', 'bob.contact@example.com']]),
}

test('buildProjects resolves members to people, sorts projects and members by name', () => {
  const doc = buildProjects(rawProjects, maps, { generatedAt: new Date('2026-06-30T01:00:00.000Z') })
  assert.equal(doc.source, 'watchog')
  assert.equal(doc.generatedAt, '2026-06-30T01:00:00.000Z')

  // projects sorted by name: Apollo before Zephyr
  assert.deepEqual(doc.projects.map((p) => p.name), ['Apollo', 'Zephyr'])

  const zephyr = doc.projects.find((p) => p.id === 'proj-z')
  assert.equal(zephyr.memberCount, 2)
  assert.equal(zephyr.private, true)
  // members sorted by name: Amy before Bob
  assert.deepEqual(zephyr.members.map((m) => m.name), ['Amy Adams', 'Bob Brown'])
  // resolved to the same person id + email the summary uses
  const amy = zephyr.members.find((m) => m.id === 'person-amy')
  assert.equal(amy.email, 'amy@example.com')
  assert.equal(amy.loginEmail, 'amy@example.com')
  assert.equal(amy.contactEmail, null)
  // owners resolved too
  assert.deepEqual(zephyr.owners.map((o) => o.id), ['person-amy'])
})

test('buildProjects degrades an unknown member UUID to itself rather than crashing', () => {
  const doc = buildProjects(rawProjects, maps, { generatedAt: new Date('2026-06-30T01:00:00.000Z') })
  const apollo = doc.projects.find((p) => p.id === 'proj-a')
  const unknown = apollo.members.find((m) => m.id === 'uuid-unknown')
  assert.ok(unknown, 'unknown UUID is still present as a member')
  assert.equal(unknown.name, 'uuid-unknown')
  assert.equal(unknown.email, null)
})

test('buildProjects with no projects yields an empty catalog, not a throw', () => {
  const doc = buildProjects([], {}, {})
  assert.deepEqual(doc.projects, [])
  assert.equal(doc.generatedAt, null)
})

// --- handler -------------------------------------------------------------

const doc = buildProjects(rawProjects, maps, { generatedAt: new Date('2026-06-30T01:00:00.000Z') })
const token = 'secret'
const auth = `Bearer ${token}`
const fresh = Date.parse('2026-06-30T01:10:00.000Z') // 10 min after generatedAt

test('GET /projects returns the light catalog (no members embedded), not stale', () => {
  const r = handleProjects({ method: 'GET', path: '/projects', authHeader: auth }, { doc, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.stale, false)
  assert.equal(r.body.projects.length, 2)
  const apollo = r.body.projects.find((p) => p.id === 'proj-a')
  assert.equal(apollo.memberCount, 2)
  assert.equal(apollo.members, undefined) // list items omit members
  assert.equal(apollo.description, undefined) // and the description
})

test('GET /projects/{id} returns one project with full description + members', () => {
  const r = handleProjects({ method: 'GET', path: '/projects/proj-z', authHeader: auth }, { doc, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.id, 'proj-z')
  assert.equal(r.body.description, 'last alphabetically')
  assert.equal(r.body.members.length, 2)
})

test('GET /projects/{id}/team returns the resolved members', () => {
  const r = handleProjects({ method: 'GET', path: '/projects/proj-z/team', authHeader: auth }, { doc, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.projectId, 'proj-z')
  assert.equal(r.body.name, 'Zephyr')
  assert.deepEqual(r.body.members.map((m) => m.name), ['Amy Adams', 'Bob Brown'])
})

test('GET /projects/{unknown} is 404', () => {
  const r = handleProjects({ method: 'GET', path: '/projects/nope', authHeader: auth }, { doc, token, now: fresh })
  assert.equal(r.status, 404)
})

test('missing or wrong bearer token is 401', () => {
  assert.equal(handleProjects({ method: 'GET', path: '/projects', authHeader: '' }, { doc, token, now: fresh }).status, 401)
  assert.equal(handleProjects({ method: 'GET', path: '/projects', authHeader: 'Bearer nope' }, { doc, token, now: fresh }).status, 401)
})

test('non-GET is 405', () => {
  const r = handleProjects({ method: 'POST', path: '/projects', authHeader: auth }, { doc, token, now: fresh })
  assert.equal(r.status, 405)
})

test('no projects document yet is 503', () => {
  const r = handleProjects({ method: 'GET', path: '/projects', authHeader: auth }, { doc: null, token, now: fresh })
  assert.equal(r.status, 503)
})

test('a document older than the staleness window is flagged stale', () => {
  const old = Date.parse('2026-06-30T03:00:00.000Z') // 2h after generatedAt
  const r = handleProjects({ method: 'GET', path: '/projects', authHeader: auth }, { doc, token, now: old })
  assert.equal(r.body.stale, true)
})

test('an /api prefix and a querystring still route correctly', () => {
  const r = handleProjects({ method: 'GET', path: '/api/projects/proj-z/team?foo=1', authHeader: auth }, { doc, token, now: fresh })
  assert.equal(r.status, 200)
  assert.equal(r.body.projectId, 'proj-z')
})
