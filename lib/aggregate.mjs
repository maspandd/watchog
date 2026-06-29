// Pure aggregation: turn a flat list of issues into per-person counts.
// No I/O here so it can be unit-tested deterministically.
//
// Inputs:
//   issues:           [{ status: <statusRef>, assignee: <personRef|null> }]
//   statusStateById:  Map<statusRef, 'done' | 'cancelled' | 'open'>
//   personNameById:   Map<personRef, displayName>
//
// Rules (see PRD / README):
//   - 'cancelled' cards are excluded entirely (counted only as `cancelled`).
//   - cards with no assignee are skipped (counted only as `unassigned`).
//   - unknown status -> treated as 'open' so nothing is silently lost.
//   - a person's cards are aggregated across all projects, one row per person.

export function aggregate(issues, statusStateById, personNameById) {
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
        total: 0,
        done: 0,
        open: 0,
      }
      byPerson.set(issue.assignee, row)
    }

    if (state === 'done') row.done++
    else row.open++
    row.total++
  }

  const rows = [...byPerson.values()].sort(
    (a, b) => b.open - a.open || a.name.localeCompare(b.name),
  )

  const totals = {
    people: rows.length,
    total: rows.reduce((n, r) => n + r.total, 0),
    done: rows.reduce((n, r) => n + r.done, 0),
    open: rows.reduce((n, r) => n + r.open, 0),
  }

  return { rows, unassigned, cancelled, totals }
}
