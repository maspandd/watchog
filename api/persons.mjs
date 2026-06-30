// Persons API handler. Pure routing function (handlePersons) for unit testing,
// plus a thin Vercel adapter. Mirrors api/summary.mjs / api/projects.mjs.
//
// Routes (GET only, bearer-authenticated), all derived from the summary snapshot:
//   /persons               -> directory of assignees (identity only)
//   /persons/{id}          -> one person's identity (404 if absent)
//   /persons/{id}/summary  -> that person's card summary (alias of /summary/{id})

import { getSnapshot } from '../lib/store.mjs'
import { authorize, json, isStale } from '../lib/apiauth.mjs'
import { personsDirectory, personEntry } from '../lib/views.mjs'

export function handlePersons({ method = 'GET', path = '/', authHeader = '' }, { snapshot, token, now }) {
  if (!authorize(authHeader, token)) return json(401, { error: 'Unauthorized' })
  if (method !== 'GET') return json(405, { error: 'Method Not Allowed' })

  // /persons, /persons/{id}, or /persons/{id}/summary — tolerant of an /api
  // prefix and a querystring. Group 1 = id, group 2 = 'summary'.
  const m = path.match(/\/persons(?:\/([^/?]+)(?:\/(summary))?)?\/?(?:\?|$)/)
  if (!m) return json(404, { error: 'Not Found' })
  if (!snapshot) return json(503, { error: 'No summary available yet' })

  const stale = isStale(snapshot.generatedAt, now)

  // /persons -> directory.
  if (!m[1]) return json(200, { ...personsDirectory(snapshot), stale })

  const id = decodeURIComponent(m[1])

  // /persons/{id}/summary -> the full person object (counts + projects).
  if (m[2]) {
    const person = (snapshot.people || []).find((p) => p.id === id)
    if (!person) return json(404, { error: 'Person not found' })
    return json(200, { ...person, generatedAt: snapshot.generatedAt, stale })
  }

  // /persons/{id} -> identity only.
  const entry = personEntry(snapshot, id)
  if (!entry) return json(404, { error: 'Person not found' })
  return json(200, { ...entry, generatedAt: snapshot.generatedAt, stale })
}

// Vercel Node serverless adapter.
export default async function handler(req, res) {
  let snapshot = null
  try {
    snapshot = await getSnapshot()
  } catch (err) {
    console.error('getSnapshot failed:', err)
    // leave snapshot null -> handler returns 503
  }

  const result = handlePersons(
    {
      method: req.method,
      path: req.url || '/persons',
      authHeader: req.headers?.authorization || '',
    },
    { snapshot, token: process.env.API_TOKEN, now: Date.now() },
  )

  res.statusCode = result.status
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v)
  res.end(JSON.stringify(result.body))
}
