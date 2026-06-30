// Summary API handler. The routing/auth logic is a pure function
// (handleSummary) so it can be unit-tested without a server and stays
// runtime-agnostic; the default export is a thin Vercel (Node) adapter that
// reads the snapshot from the store and maps the result onto the response.
//
// Routes (GET only, bearer-authenticated):
//   /summary        -> the full roster snapshot
//   /summary/{id}   -> one person by Huly person id (404 if absent)

import { getSnapshot } from '../lib/store.mjs'
import { authorize, json, isStale } from '../lib/apiauth.mjs'

export function handleSummary({ method = 'GET', path = '/', authHeader = '' }, { snapshot, token, now }) {
  if (!authorize(authHeader, token)) return json(401, { error: 'Unauthorized' })
  if (method !== 'GET') return json(405, { error: 'Method Not Allowed' })

  // Match /summary or /summary/{id}, tolerant of an /api prefix and querystring.
  const m = path.match(/\/summary(?:\/([^/?]+))?\/?(?:\?|$)/)
  if (!m) return json(404, { error: 'Not Found' })
  if (!snapshot) return json(503, { error: 'No summary available yet' })

  const stale = isStale(snapshot.generatedAt, now)

  if (m[1]) {
    const id = decodeURIComponent(m[1])
    const person = (snapshot.people || []).find((p) => p.id === id)
    if (!person) return json(404, { error: 'Person not found' })
    return json(200, { ...person, generatedAt: snapshot.generatedAt, stale })
  }
  return json(200, { ...snapshot, stale })
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

  const result = handleSummary(
    {
      method: req.method,
      path: req.url || '/summary',
      authHeader: req.headers?.authorization || '',
    },
    { snapshot, token: process.env.API_TOKEN, now: Date.now() },
  )

  res.statusCode = result.status
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v)
  res.end(JSON.stringify(result.body))
}
