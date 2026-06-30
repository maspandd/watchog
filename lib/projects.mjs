// Build the JSON document the Projects API serves. Pure (no I/O) so it is
// unit-testable, mirroring lib/snapshot.mjs and lib/aggregate.mjs.
//
// Input: the raw projects from fetchProjects (members[]/owners[] are account
// UUIDs), plus the resolution maps already built in fetchData. Each member and
// owner is resolved to the same person shape the summary uses — id (Person._id),
// name, and the two email sources — so consumers map on the same person id.
//
// Resolution is best effort: an unknown UUID degrades to itself as the id/name
// rather than crashing. The `stale` flag is NOT set here — it is derived at read
// time by the API handler from `generatedAt`.

function byName(a, b) {
  return a.name.localeCompare(b.name)
}

export function buildProjects(rawProjects = [], maps = {}, { generatedAt } = {}) {
  const {
    personByUuid = new Map(),
    personNameById = new Map(),
    loginEmailById = new Map(),
    contactEmailById = new Map(),
  } = maps

  // account UUID -> the same person shape the summary exposes.
  const resolvePerson = (uuid) => {
    const id = personByUuid.get(uuid) ?? uuid
    const loginEmail = loginEmailById.get(id) ?? null
    const contactEmail = contactEmailById.get(id) ?? null
    return {
      id,
      name: personNameById.get(id) ?? String(uuid),
      email: loginEmail ?? contactEmail, // best available
      loginEmail,
      contactEmail,
    }
  }

  const projects = rawProjects
    .map((pr) => {
      const members = (pr.members ?? []).map(resolvePerson).sort(byName)
      const owners = (pr.owners ?? []).map(resolvePerson).sort(byName)
      return {
        id: pr.id,
        name: pr.name,
        identifier: pr.identifier ?? null,
        description: pr.description ?? '',
        private: pr.private ?? false,
        archived: pr.archived ?? false,
        memberCount: members.length,
        owners,
        members,
      }
    })
    .sort(byName)

  return {
    generatedAt: generatedAt ? generatedAt.toISOString() : null,
    source: 'watchog',
    projects,
  }
}
