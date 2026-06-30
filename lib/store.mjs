// Resource handoff between the cron (writer) and the serverless API (reader).
// They run in separate environments and cannot share a local file, so each
// resource lives under its own key in an external HTTP key/value store. All
// store specifics are isolated here behind putResource/getResource so the
// provider is swappable; putSnapshot/getSnapshot are thin wrappers kept for the
// Summary API's existing call sites.
//
// Default target: Vercel KV / Upstash Redis REST. SET via `POST {url}/set/{key}`
// with the JSON body; GET via `GET {url}/get/{key}` returning `{ result }`.
// Fails loud on a non-OK response, mirroring sendTelegram in lib/telegram.mjs.

export const SUMMARY_KEY = 'watchog:summary'
export const PROJECTS_KEY = 'watchog:projects'

function storeConfig({ url, token } = {}) {
  return {
    url: url ?? process.env.SNAPSHOT_STORE_URL,
    token: token ?? process.env.SNAPSHOT_STORE_TOKEN,
  }
}

export async function putResource(key, value, opts = {}) {
  const { url, token } = storeConfig(opts)
  const res = await fetch(`${url}/set/${key}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(value),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resource store SET ${key} error ${res.status}: ${body}`)
  }
  return res.json().catch(() => ({}))
}

export async function getResource(key, opts = {}) {
  const { url, token } = storeConfig(opts)
  const res = await fetch(`${url}/get/${key}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resource store GET ${key} error ${res.status}: ${body}`)
  }
  const data = await res.json()
  if (data == null || data.result == null) return null
  return typeof data.result === 'string' ? JSON.parse(data.result) : data.result
}

// Summary-specific wrappers, preserved for existing call sites.
export const putSnapshot = (snapshot, opts = {}) => putResource(SUMMARY_KEY, snapshot, opts)
export const getSnapshot = (opts = {}) => getResource(SUMMARY_KEY, opts)
