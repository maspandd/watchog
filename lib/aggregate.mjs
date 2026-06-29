// Pure aggregation: turn a flat list of issues into per-person counts.
// No I/O here so it can be unit-tested deterministically.
//
// Inputs:
//   issues:           [{ status: <statusRef>, assignee: <personRef|null>, space: <projectRef|null> }]
//   statusStateById:  Map<statusRef, 'done' | 'cancelled' | 'open'>
//   personNameById:   Map<personRef, displayName>
//   projectNameById:  Map<projectRef, projectName>   (optional; for the per-person breakdown)
//   personEmailById:  Map<personRef, email>          (optional; null when absent)
//
// Rules (see PRD / README):
//   - 'cancelled' cards are excluded entirely (counted only as `cancelled`).
//   - cards with no assignee are skipped (counted only as `unassigned`).
//   - unknown status -> treated as 'open' so nothing is silently lost.
//   - a person's cards are aggregated across all projects, one row per person,
//     plus a per-project breakdown so the API can show where the work lives.

export function aggregate(
  issues,
  statusStateById,
  personNameById,
  projectNameById = new Map(),
  personEmailById = new Map(),
) {
  const byPerson = new Map()
  let unassigned = 0
  let cancelled = 0

  for (const issue of issues) {
    const state = statusStateById.get(issue.status) ?? 'open'

    if (state === 'cancelled') {
      cancelled++
      continue
    }
    if (!issue.assignee) {
      unassigned++
      continue
    }

    let row = byPerson.get(issue.assignee)
    if (row === undefined) {
      row = {
        id: issue.assignee,
        name: personNameById.get(issue.assignee) ?? String(issue.assignee),
        email: personEmailById.get(issue.assignee) ?? null,
        total: 0,
        done: 0,
        open: 0,
        projectsById: new Map(), // collapsed into `projects` array below
      }
      byPerson.set(issue.assignee, row)
    }

    const isDone = state === 'done'
    if (isDone) row.done++
    else row.open++
    row.total++

    // Per-project breakdown. Cards with no space are still counted at the
    // person level above; they just don't contribute a project row.
    if (issue.space) {
      let proj = row.projectsById.get(issue.space)
      if (proj === undefined) {
        proj = {
          id: issue.space,
          name: projectNameById.get(issue.space) ?? String(issue.space),
          total: 0,
          done: 0,
          open: 0,
        }
        row.projectsById.set(issue.space, proj)
      }
      if (isDone) proj.done++
      else proj.open++
      proj.total++
    }
  }

  const rows = [...byPerson.values()]
    .map(({ projectsById, ...rest }) => ({
      ...rest,
      projects: [...projectsById.values()].sort(
        (a, b) => b.open - a.open || a.name.localeCompare(b.name),
      ),
    }))
    .sort((a, b) => b.open - a.open || a.name.localeCompare(b.name))

  const totals = {
    people: rows.length,
    total: rows.reduce((n, r) => n + r.total, 0),
    done: rows.reduce((n, r) => n + r.done, 0),
    open: rows.reduce((n, r) => n + r.open, 0),
  }

  return { rows, unassigned, cancelled, totals }
}
