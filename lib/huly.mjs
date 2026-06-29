// Read-only access to Huly via the official SDK.
// All SDK-specific knowledge is isolated in this module.
//
// @hcengineering/api-client is a CommonJS module, so `connect` must be taken
// off the default import (named ESM imports are not available from it).
//
// Huly plugin ids are stable string identifiers. Card status is classified by
// its status *category*. This instance uses the generic `task:statusCategory:*`
// ids ("Won" = completed, "Lost" = cancelled); older/other setups use the
// `tracker:statusCategory:*` ids. We match both so the mapping survives an
// upgrade. Anything not explicitly done/cancelled counts as open.
import apiClient from '@hcengineering/api-client'

const { connect, NodeWebSocketFactory } = apiClient

const ISSUE_CLASS = 'tracker:class:Issue'
const ISSUE_STATUS_CLASS = 'tracker:class:IssueStatus'
const PERSON_CLASS = 'contact:class:Person'

const DONE_CATEGORIES = new Set([
  'task:statusCategory:Won',
  'tracker:statusCategory:Completed',
])
const CANCELLED_CATEGORIES = new Set([
  'task:statusCategory:Lost',
  'tracker:statusCategory:Cancelled',
])

export async function connectHuly({ url, email, password, workspace }) {
  return connect(url, { email, password, workspace, socketFactory: NodeWebSocketFactory })
}

// Huly stores Person.name as "Last,First".
export function nameOf(person) {
  if (!person || !person.name) return 'Unknown'
  const parts = String(person.name).split(',').map((s) => s.trim()).filter(Boolean)
  if (parts.length === 2) return `${parts[1]} ${parts[0]}`
  if (parts.length === 1) return parts[0]
  return person.name
}

export function stateOf(categoryId) {
  if (DONE_CATEGORIES.has(categoryId)) return 'done'
  if (CANCELLED_CATEGORIES.has(categoryId)) return 'cancelled'
  return 'open'
}

// Fetch the three things the aggregator needs. Read-only.
export async function fetchData(client) {
  const statuses = await client.findAll(ISSUE_STATUS_CLASS, {})
  const statusStateById = new Map()
  for (const s of statuses) statusStateById.set(s._id, stateOf(s.category))

  const persons = await client.findAll(PERSON_CLASS, {})
  const personNameById = new Map()
  for (const p of persons) personNameById.set(p._id, nameOf(p))

  const rawIssues = await client.findAll(ISSUE_CLASS, {})
  const issues = rawIssues.map((i) => ({ status: i.status, assignee: i.assignee ?? null }))

  return { issues, statusStateById, personNameById }
}
