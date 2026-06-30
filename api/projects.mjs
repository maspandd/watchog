// Projects API handler. The routing/auth logic is a pure function
// (handleProjects) so it can be unit-tested without a server and stays
// runtime-agnostic; the default export is a thin Vercel (Node) adapter that
// reads the projects document from the store and maps the result onto the
// response. Mirrors api/summary.mjs.
//
// Routes (GET only, bearer-authenticated):
//   /projects             -> the project catalog (light: no members embedded)
//   /projects/{id}        -> one project with full description + members[]
//   /projects/{id}/team   -> that project's members, resolved to people
//
// 404 on an unknown id; 503 until the cron has written the document.

import { getResource, PROJECTS_KEY } from '../lib/store.mjs'
import { authorize, json, isStale } from '../lib/apiauth.mjs'

// List items are intentionally light: drop members[]/description, and reduce
// owners to id+name so the catalog stays small and PII-free.
function toListItem(p) {
  return {
    id: p.id,
    name: p.name,
    identifier: p.identifier ?? null,
    archived: p.archived ?? false,
    private: p.private ?? false,
    memberCount: p.memberCount ?? (p.members ? p.members.length : 0),
    owners: (p.owners ?? []).map((o) => ({ id: o.id, name: o.name })),
  }
}

export function handleProjects({ method = 'GET', path = '/', authHeader = '' }, { doc, token, now }) {
  if (!authorize(authHeader, token)) return json(401, { error: 'Unauthorized' })
  if (method !== 'GET') return json(405, { error: 'Method Not Allowed' })

  // Match /projects, /projects/{id}, or /projects/{id}/team — tolerant of an
  // /api prefix and a querystring. Group 1 = id, group 2 = 'team'.
  const m = path.match(/\/projects(?:\/([^/?]+)(?:\/(team))?)?\/?(?:\?|$)/)
  if (!m) return json(404, { error: 'Not Found' })
  if (!doc) return json(503, { error: 'No projects available yet' })

  const stale = isStale(doc.generatedAt, now)
  const projects = doc.projects || []

  // /projects -> the catalog list.
  if (!m[1]) {
    return json(200, {
      generatedAt: doc.generatedAt ?? null,
      source: doc.source ?? 'watchog',
      stale,
      projects: projects.map(toListItem),
    })
  }

  const id = decodeURIComponent(m[1])
  const project = projects.find((p) => p.id === id)
  if (!project) return json(404, { error: 'Project not found' })

  // /projects/{id}/team -> just the members, resolved to people.
  if (m[2]) {
    return json(200, {
      projectId: project.id,
      name: project.name,
      stale,
      generatedAt: doc.generatedAt ?? null,
      members: project.members ?? [],
    })
  }

  // /projects/{id} -> the full project.
  return json(200, { ...project, generatedAt: doc.generatedAt ?? null, stale })
}

// Vercel Node serverless adapter.
export default async function handler(req, res) {
  let doc = null
  try {
    doc = await getResource(PROJECTS_KEY)
  } catch (err) {
    console.error('getResource(projects) failed:', err)
    // leave doc null -> handler returns 503
  }

  const result = handleProjects(
    {
      method: req.method,
      path: req.url || '/projects',
      authHeader: req.headers?.authorization || '',
    },
    { doc, token: process.env.API_TOKEN, now: Date.now() },
  )

  res.statusCode = result.status
  for (const [k, v] of Object.entries(result.headers)) res.setHeader(k, v)
  res.end(JSON.stringify(result.body))
}
