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
//
// "Best effort" fields (Milestone 2), each isolated and degrading to absent
// rather than failing the run:
//   - project: each issue's `space` ref -> `tracker:class:Project` name.
//   - email comes from TWO independent sources, surfaced separately:
//       loginEmail   <- contact:class:SocialIdentity (type "email") — the
//                       account/login identity; present for most members.
//       contactEmail <- contact:class:Channel (provider Email) — an explicitly
//                       added contact channel; often empty.
import apiClient from '@hcengineering/api-client'

const { connect, NodeWebSocketFactory } = apiClient

const ISSUE_CLASS = 'tracker:class:Issue'
const ISSUE_STATUS_CLASS = 'tracker:class:IssueStatus'
const PROJECT_CLASS = 'tracker:class:Project'
const PERSON_CLASS = 'contact:class:Person'
const SOCIAL_IDENTITY_CLASS = 'contact:class:SocialIdentity'
const CHANNEL_CLASS = 'contact:class:Channel'
const EMAIL_PROVIDER = 'contact:channelProvider:Email'

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

// Fetch everything the aggregator needs. Read-only.
export async function fetchData(client) {
  const statuses = await client.findAll(ISSUE_STATUS_CLASS, {})
  const statusStateById = new Map()
  for (const s of statuses) statusStateById.set(s._id, stateOf(s.category))

  const persons = await client.findAll(PERSON_CLASS, {})
  const personNameById = new Map()
  for (const p of persons) personNameById.set(p._id, nameOf(p))

  // Project (space) names. Best effort: fall back to the ref if unavailable.
  const projectNameById = new Map()
  try {
    const projects = await client.findAll(PROJECT_CLASS, {})
    for (const pr of projects) projectNameById.set(pr._id, pr.name ?? String(pr._id))
  } catch (err) {
    console.error('Project lookup failed (projects will use raw refs):', err)
  }

  // Email, from two independent sources, kept separate. Both best effort.
  // 1) login/account identity (SocialIdentity, type "email").
  const loginEmailById = new Map()
  try {
    const socialIds = await client.findAll(SOCIAL_IDENTITY_CLASS, { type: 'email' })
    for (const s of socialIds) {
      if (s.attachedTo && s.value && !s.isDeleted && !loginEmailById.has(s.attachedTo)) {
        loginEmailById.set(s.attachedTo, s.value)
      }
    }
  } catch (err) {
    console.error('Social identity lookup failed (loginEmail will be null):', err)
  }

  // 2) explicitly added contact email channel.
  const contactEmailById = new Map()
  try {
    const channels = await client.findAll(CHANNEL_CLASS, { provider: EMAIL_PROVIDER })
    for (const ch of channels) {
      if (ch.attachedTo && ch.value && !contactEmailById.has(ch.attachedTo)) {
        contactEmailById.set(ch.attachedTo, ch.value)
      }
    }
  } catch (err) {
    console.error('Email channel lookup failed (contactEmail will be null):', err)
  }

  const rawIssues = await client.findAll(ISSUE_CLASS, {})
  const issues = rawIssues.map((i) => ({
    status: i.status,
    assignee: i.assignee ?? null,
    space: i.space ?? null,
  }))

  return {
    issues,
    statusStateById,
    personNameById,
    projectNameById,
    loginEmailById,
    contactEmailById,
  }
}
