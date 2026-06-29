// Snapshot handoff between the cron (writer) and the serverless API (reader).
// They run in separate environments and cannot share a local file, so the
// latest summary lives in an external HTTP key/value store. All store specifics
// are isolated here behind putSnapshot/getSnapshot so the provider is swappable.
//
// Default target: Vercel KV / Upstash Redis REST. SET via `POST {url}/set/{key}`
// with the JSON body; GET via `GET {url}/get/{key}` returning `{ result }`.
// Fails loud on a non-OK response, mirroring sendTelegram in lib/telegram.mjs.

const KEY = 'watchog:summary'

function storeConfig({ url, token } = {}) {
  return {
    url: url ?? process.env.SNAPSHOT_STORE_URL,
    token: token ?? process.env.SNAPSHOT_STORE_TOKEN,
  }
}

export async function putSnapshot(snapshot, opts = {}) {
  const { url, token } = storeConfig(opts)
  const res = await fetch(`${url}/set/${KEY}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(snapshot),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Snapshot store SET error ${res.status}: ${body}`)
  }
  return res.json().catch(() => ({}))
}

export async function getSnapshot(opts = {}) {
  const { url, token } = storeConfig(opts)
  const res = await fetch(`${url}/get/${KEY}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Snapshot store GET error ${res.status}: ${body}`)
  }
  const data = await res.json()
  if (data == null || data.result == null) return null
  return typeof data.result === 'string' ? JSON.parse(data.result) : data.result
}
