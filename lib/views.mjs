// Pure reshapers that derive orthogonal views from the cron's snapshots.
// No I/O, so they are unit-testable, mirroring lib/snapshot.mjs and
// lib/projects.mjs. The `stale` flag is added by the API handlers, not here.
//
// All four views derive from the existing `watchog:summary` snapshot (and, for
// project names/404s, the `watchog:projects` catalog) — no new cron data.

// Person directory: identity only (no card counts), assignees from the roster,
// sorted by name.
export function personsDirectory(snapshot = {}) {
  const persons = (snapshot.people || [])
    .map((p) => ({
      id: p.id,
      name: p.name,
      email: p.email ?? null,
      loginEmail: p.loginEmail ?? null,
      contactEmail: p.contactEmail ?? null,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  return {
    generatedAt: snapshot.generatedAt ?? null,
    source: snapshot.source ?? 'watchog',
    persons,
  }
}

// One person's identity (no counts). Returns null when absent (-> 404).
export function personEntry(snapshot = {}, id) {
  const p = (snapshot.people || []).find((x) => x.id === id)
  if (!p) return null
  return {
    id: p.id,
    name: p.name,
    email: p.email ?? null,
    loginEmail: p.loginEmail ?? null,
    contactEmail: p.contactEmail ?? null,
  }
}

// Overall totals only — the lean overview.
export function overview(snapshot = {}) {
  return {
    generatedAt: snapshot.generatedAt ?? null,
    source: snapshot.source ?? 'watchog',
    totals: snapshot.totals ?? { people: 0, total: 0, done: 0, open: 0 },
    unassigned: snapshot.unassigned ?? 0,
    cancelled: snapshot.cancelled ?? 0,
  }
}

// Per-project card summary, derived by summing each person's per-project counts
// for this project id. Note: this excludes unassigned cards and cards with no
// project (they never appear in a person's `projects[]`). Returns null when the
// id is in neither the catalog nor any person's breakdown (-> 404).
export function projectSummary(snapshot = {}, catalog = {}, id) {
  const inCatalog = (catalog.projects || []).find((p) => p.id === id) ?? null

  const people = []
  let total = 0
  let done = 0
  let open = 0
  let derivedName = null

  for (const person of snapshot.people || []) {
    const proj = (person.projects || []).find((p) => p.id === id)
    if (!proj) continue
    derivedName = derivedName ?? proj.name
    people.push({ id: person.id, name: person.name, open: proj.open, done: proj.done, total: proj.total })
    total += proj.total
    done += proj.done
    open += proj.open
  }

  if (!inCatalog && people.length === 0) return null

  people.sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))

  return {
    projectId: id,
    name: inCatalog?.name ?? derivedName ?? String(id),
    identifier: inCatalog?.identifier ?? null,
    totals: { people: people.length, total, done, open },
    people,
  }
}
