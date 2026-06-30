// Local dev server: serves the Vercel handlers on one Node http port so the
// pull APIs can be exercised end-to-end against the live store without
// deploying. Routing mirrors vercel.json. Reads the same env as production
// (API_TOKEN + SNAPSHOT_STORE_*), so it returns whatever the last cron wrote.
//
//   node local-server.mjs            # listens on http://localhost:3000
//   PORT=4000 node local-server.mjs  # custom port
//
// Then, with the API token from .env:
//   curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/summary
//   curl -H "Authorization: Bearer $API_TOKEN" http://localhost:3000/projects
import 'dotenv/config'
import http from 'node:http'
import { readFile } from 'node:fs/promises'
import summary from './api/summary.mjs'
import projects from './api/projects.mjs'
import persons from './api/persons.mjs'

const PORT = Number(process.env.PORT) || 3000

// Static doc assets (Vercel serves these from public/ automatically; replicate
// locally so /docs and /openapi.json work the same in dev).
async function serveStatic(res, file, type) {
  try {
    const body = await readFile(new URL(file, import.meta.url))
    res.statusCode = 200
    res.setHeader('content-type', type)
    res.end(body)
  } catch {
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({ error: 'Not Found' }))
  }
}

const server = http.createServer((req, res) => {
  const path = (req.url || '').split('?')[0]
  if (path === '/openapi.json') return serveStatic(res, './public/openapi.json', 'application/json')
  if (path === '/docs' || path === '/docs/') return serveStatic(res, './public/docs/index.html', 'text/html; charset=utf-8')
  if (path === '/overview') return summary(req, res) // overview is served by the summary handler
  if (path === '/summary' || path.startsWith('/summary/')) return summary(req, res)
  if (path === '/persons' || path.startsWith('/persons/')) return persons(req, res)
  if (path === '/projects' || path.startsWith('/projects/')) return projects(req, res)
  res.statusCode = 404
  res.setHeader('content-type', 'application/json')
  res.end(JSON.stringify({ error: 'Not Found' }))
})

server.listen(PORT, () => console.log(`watchog dev API listening on http://localhost:${PORT}`))
