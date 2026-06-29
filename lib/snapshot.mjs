// Build the JSON document the Summary API serves. Pure (no I/O) so it is
// unit-testable, mirroring lib/aggregate.mjs and formatSummary in telegram.mjs.
//
// Shape (per person): id (stable Huly person _id, for consumer-side mapping),
// name, email (null when Huly has no email channel), open/done/total, and a
// per-project breakdown. The `stale` flag is NOT set here — it is derived at
// read time by the API handler from `generatedAt`.

export function buildSnapshot(result, { generatedAt } = {}) {
  const { rows, totals, unassigned, cancelled } = result
  return {
    generatedAt: generatedAt ? generatedAt.toISOString() : null,
    source: 'watchog',
    people: rows.map((r) => ({
      id: r.id,
      name: r.name,
      email: r.email ?? null,
      open: r.open,
      done: r.done,
      total: r.total,
      projects: r.projects ?? [],
    })),
    totals,
    unassigned,
    cancelled,
  }
}
