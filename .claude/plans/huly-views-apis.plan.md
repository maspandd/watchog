# Plan: Separate person / summary / per-person / per-project views

**Source**: free-form request ("separate persons, summary, per person-summary, per project-summary. Is it possible?")
**Proposed Milestone**: #4 — orthogonal view APIs (extends M2/M3)
**Complexity**: Small–Medium (all four views derive from the existing snapshots; no new Huly calls)

## Summary
Expose four orthogonal read-only views over the data the cron already publishes:
a person directory, an overall summary, a per-person summary, and a per-project
summary. All derive from the existing `watchog:summary` snapshot (plus the
`watchog:projects` catalog for project names/404s) — no new cron work, no new
store key. Existing routes are unchanged (no breaking change).

## Confirmed decisions (2026-06-30)
- **Routing**: resource-oriented — `/persons*` + `/projects/{id}/summary`; overall totals at `/overview`.
- **`/summary` back-compat**: keep returning the full roster (M2 consumer unaffected); the overall summary lives at the new `/overview`.
- **Per-project data**: derive by summing `people[].projects` across people (cheap, reconciles with `/summary`; excludes unassigned + no-space cards — documented).
- **Persons scope**: assignees only (derived from the roster); no full-directory cron change.

## Final route map
| Route | Returns | Reads | Source |
|---|---|---|---|
| `GET /persons` | Directory of assignees `{id,name,email,loginEmail,contactEmail}` | `watchog:summary` | derived |
| `GET /persons/{id}` | One person's identity (no counts) | `watchog:summary` | derived |
| `GET /persons/{id}/summary` | Per-person card summary (`open/done/total` + `projects[]`) | `watchog:summary` | alias of `/summary/{id}` |
| `GET /overview` | Overall totals only (`totals`, `unassigned`, `cancelled`) | `watchog:summary` | derived |
| `GET /projects/{id}/summary` | Per-project totals + per-person rows | `watchog:summary` (+ `watchog:projects`) | derived |

Unchanged: `/summary`, `/summary/{id}`, `/projects`, `/projects/{id}`, `/projects/{id}/team`.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Pure builder | `lib/snapshot.mjs`, `lib/projects.mjs` | New pure reshapers in `lib/views.mjs` |
| Handler + adapter | `api/summary.mjs`, `api/projects.mjs` | `handlePersons` + adapter; extend the other two |
| Shared auth/stale | `lib/apiauth.mjs` (`authorize`/`json`/`isStale`) | Reuse verbatim |
| Store read | `lib/store.mjs` `getResource`, `SUMMARY_KEY`/`PROJECTS_KEY` | Reuse; no new key |
| Tests | `test/api.test.mjs`, `test/projects.test.mjs` | `test/views.test.mjs` |

## Files to Change
| File | Action | Why |
|---|---|---|
| `lib/views.mjs` | CREATE | Pure `personsDirectory`, `overview`, `projectSummary` |
| `test/views.test.mjs` | CREATE | Reshapers + handlers (200/404/401/405/503/stale) |
| `api/persons.mjs` | CREATE | `handlePersons` routing `/persons`, `/persons/{id}`, `/persons/{id}/summary` + adapter |
| `api/summary.mjs` | UPDATE | Add `/overview` branch (totals only) |
| `api/projects.mjs` | UPDATE | Add `/projects/{id}/summary`; adapter also reads `watchog:summary` |
| `vercel.json` | UPDATE | Rewrites for the 5 new routes |
| `local-server.mjs` | UPDATE | Route `/persons*`, `/overview` |
| `docs/API.md` | UPDATE | Document the new resources |
| `.claude/prds/huly-kpi-poller.prd.md` | UPDATE | Add Milestone 4 row |

## Response shapes
```jsonc
// GET /persons
{ "generatedAt": "...", "source": "watchog", "stale": false,
  "persons": [ { "id":"...","name":"Jane Doe","email":"...","loginEmail":"...","contactEmail":null } ] }
// GET /overview
{ "generatedAt":"...","source":"watchog","stale":false,
  "totals":{ "people":44,"total":4146,"done":3185,"open":961 }, "unassigned":623, "cancelled":76 }
// GET /projects/{id}/summary
{ "projectId":"...","name":"High-Code","identifier":"HC","stale":false,"generatedAt":"...",
  "totals":{ "people":7,"total":120,"done":80,"open":40 },
  "people":[ { "id":"...","name":"Jane Doe","open":12,"done":5,"total":17 } ] }
```
`/persons/{id}/summary` returns the same person object `/summary/{id}` serves.

## Tasks
1. `lib/views.mjs` + `test/views.test.mjs` — four pure reshapers; `projectSummary` sums `people[].projects` for the id, sorts people by open desc, 404 when the id is in neither catalog nor any person.
2. Handlers — `api/persons.mjs` (new); `/overview` branch in `api/summary.mjs`; `/{id}/summary` branch in `api/projects.mjs` (adapter fetches both snapshots). Reuse `lib/apiauth.mjs`.
3. Routing — `vercel.json` rewrites + `local-server.mjs` routes.
4. Docs + PRD — `docs/API.md` sections; Milestone 4 row.

## Validation
```bash
node --test                       # all suites incl. views
node local-server.mjs             # curl the 5 new routes with $API_TOKEN
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Per-project totals exclude unassigned/no-space cards (derive choice) | Medium | Document in `docs/API.md`; revisit to project-centric recompute if needed |
| `/persons/{id}/summary` duplicates `/summary/{id}` | Low | Share one code path; document as alias |
| Projects handler now needs two store reads | Low | Only the `/summary` sub-route reads both; 503 if either missing |

## Acceptance
- [ ] 5 new routes return correct data; 404/401/405/503/stale behave as siblings
- [ ] `/summary`, `/projects/*` unchanged (existing tests stay green)
- [ ] Per-project numbers reconcile with `/summary` people breakdown
- [ ] Patterns mirrored; reshapers pure and tested; auth shared
