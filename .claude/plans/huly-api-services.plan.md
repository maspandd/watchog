# Plan: Huly Resource APIs (Projects, Project detail, Teams, …)

**Source**: free-form request ("add more API services from Huly — project list, detail, teams, and so on")
**Proposed Milestone**: #3 — Huly resource APIs (extends the M2 Summary API)
**Complexity**: Medium–Large (several new endpoints + a verify-first Huly project/membership model)

## Summary
Expose more read-only Huly data through the same pull API: a project list, project
detail, and project team/members — with room to add more resources. Keep the M2
**cached-snapshot** architecture: the cron (which already talks to Huly) also fetches
the project catalog and writes it to the store under a new key; bearer-authenticated
serverless endpoints serve slices of it. The serverless function stays Huly-free
(reads the store only), consistent with `api/summary.mjs`.

## Architecture decision (recommended default — confirm or override)
**Cached snapshot, not live.** The cron builds a `projects` document (catalog with
members embedded) and stores it under `watchog:projects`; endpoints index into it.
- `GET /projects` → the catalog list
- `GET /projects/{id}` → one project (404 if absent)
- `GET /projects/{id}/team` → that project's members, resolved to people
The alternative — querying Huly live per request — would require Huly credentials and
the WebSocket SDK inside the serverless function (slow login-per-call, awkward runtime).
Not recommended; the cached model gives the same data, fast and cheap, as fresh as the
last cron run.

## Confirmed Huly model (probed 2026-06-30 — no more guessing)
- **28 projects** on `tracker:class:Project`. Fields: `name`, `identifier` (e.g. `HRIS`),
  `description` (may be `""`), `private`, `archived`, `members[]`, `owners[]`,
  `defaultAssignee` (nullable). **There is no `lead` field — `owners[]` is the lead.**
- `members[]` and `owners[]` are **account UUIDs** (e.g. `7b549ac2-3a77-…`), a different
  id space than `Person._id`. They resolve via **`Person.personUuid`** → `Person._id`
  (the same id `/summary` uses). Confirmed: member `7b549ac2…` → Person "Wati,Vera".
- Build a `personByUuid` map (`personUuid → { id: _id, name, emails }`) from the persons
  already fetched in `fetchData`; resolve members/owners through it. Degrade unknown
  UUIDs to the raw id.
- Bonus per Person (available if wanted): `contact:mixin:Employee` (`role`, `active`) and
  `hr:mixin:Staff` (`department`).
- **Private projects**: many are `private: true`; the poller sees only the projects its
  login belongs to — documented coverage caveat (service-account is an open PRD question).

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| SDK isolation + verify-first | `lib/huly.mjs` (`fetchData`, email/project best-effort) | All Huly class ids / field reads in `lib/huly.mjs`; degrade to absent, never crash |
| Pure builder | `lib/snapshot.mjs` (`buildSnapshot`) | New `lib/projects.mjs` `buildProjects(...)` is pure and unit-tested |
| Store IO | `lib/store.mjs` (`putSnapshot`/`getSnapshot`, key `watchog:summary`) | Generalize to `putResource(key,v)`/`getResource(key)`; new key `watchog:projects` |
| API handler | `api/summary.mjs` (pure `handleSummary` + Vercel adapter, `safeEqual`, `stale`) | New `api/projects.mjs` same shape; extract shared auth/json to `lib/apiauth.mjs` |
| Multi-channel write | `poller.mjs` (`Promise.allSettled`, attempt-all-fail-if-any, dry-run prints) | Add the projects write as a third channel; `--dry-run` prints it |
| Tests | `test/api.test.mjs`, `test/snapshot.test.mjs` (`node:test`, pure core, synthetic) | `test/projects.test.mjs` for builder + handler |

## Files to Change
| File | Action | Why |
|---|---|---|
| `lib/huly.mjs` | UPDATE | `fetchProjects(client, peopleMaps)` — projects + members + lead, members resolved to people; best effort |
| `lib/projects.mjs` | CREATE | Pure `buildProjects(rawProjects, …)` → the `projects` document |
| `lib/store.mjs` | UPDATE | Generalize to `putResource(key, value)` / `getResource(key)`; keep summary wrappers |
| `lib/apiauth.mjs` | CREATE | Shared `safeEqual` / `authorize(authHeader, token)` + `json()` helper (DRY across handlers) |
| `api/summary.mjs` | UPDATE | Use the shared auth/json helper (no behavior change) |
| `api/projects.mjs` | CREATE | Pure `handleProjects({method,path,authHeader},{doc,token,now})` routing the 3 endpoints + adapter |
| `poller.mjs` | UPDATE | Build + write `projects` resource alongside the summary; dry-run prints it; add to attempt-all |
| `vercel.json` | UPDATE | Rewrites for `/projects`, `/projects/:id`, `/projects/:id/team` |
| `test/projects.test.mjs` | CREATE | `buildProjects` shape + `handleProjects` (200 list / 200 detail / 200 team / 404 / 401 / 405 / 503) |
| `README.md` | UPDATE | Document the new endpoints + response shapes |
| `.claude/prds/huly-kpi-poller.prd.md` | UPDATE | Add Milestone 3 row (Huly resource APIs) |

## Response shapes (default — confirm field names)
`GET /projects`:
```json
{
  "generatedAt": "2026-06-30T01:00:00.000Z",
  "source": "watchog",
  "stale": false,
  "projects": [
    { "id": "<space _id>", "name": "High-Code", "identifier": "HC",
      "archived": false, "private": false, "memberCount": 7,
      "owners": [{ "id": "<person _id>", "name": "Jane Doe" }] }
  ]
}
```
`GET /projects/{id}` → one project with full `description` + embedded `members[]`.
`GET /projects/{id}/team`:
```json
{ "projectId": "<space _id>", "name": "High-Code", "stale": false,
  "members": [ { "id": "<person _id>", "name": "Jane Doe",
                 "email": "jane@x.com", "loginEmail": "jane@x.com", "contactEmail": null } ] }
```
- People are resolved with the same `name` + `email`/`loginEmail`/`contactEmail` logic as
  `/summary`, so consumers map on the same person `id`.
- `401`/`405`/`503` and the `generatedAt` + `stale` flag behave exactly as `/summary`.

## Tasks
### Task 1: ✅ DONE — Huly project/membership model probed (see Confirmed Huly model above)
Members/owners are account UUIDs resolved via `Person.personUuid → Person._id`. No code yet.

### Task 2: `lib/huly.mjs` — fetch projects + resolve members
- **Action**: In `fetchData`, also build `personByUuid` (`personUuid → { id, name }`) from
  the already-fetched persons. Add `fetchProjects(client)` returning the raw projects;
  resolution of `members[]`/`owners[]` (UUIDs) → people goes through `personByUuid`,
  reusing `personNameById` + the email maps. Best effort; unknown UUIDs degrade to the raw
  id; missing fields never crash. Read-only.
- **Mirror**: existing `fetchData` best-effort + try/catch logging.
- **Validate**: temporary run logs the 28 projects and one project's resolved members.

### Task 3: `lib/projects.mjs` + `test/projects.test.mjs` (builder)
- **Action**: Pure `buildProjects(...)` → the document above (list with embedded members,
  memberCount, lead). Sort projects by name; members by name.
- **Mirror**: `lib/snapshot.mjs` purity.
- **Validate**: `node --test test/projects.test.mjs` passes.

### Task 4: `lib/store.mjs` — generalize to keyed resources
- **Action**: Add `putResource(key, value)` / `getResource(key)`; reimplement
  `putSnapshot`/`getSnapshot` as wrappers over key `watchog:summary`. New key
  `watchog:projects`.
- **Mirror**: existing fetch/throw shape.
- **Validate**: existing summary path unchanged; a put/get round-trips on the new key.

### Task 5: `lib/apiauth.mjs` + `api/projects.mjs` (+ refactor `api/summary.mjs`)
- **Action**: Extract `safeEqual`/`authorize`/`json` to `lib/apiauth.mjs`; point
  `api/summary.mjs` at it (no behavior change). Implement pure `handleProjects` routing
  `/projects`, `/projects/{id}`, `/projects/{id}/team` (404 on unknown id) + Vercel adapter
  reading `watchog:projects` via `getResource`.
- **Mirror**: `api/summary.mjs` core + adapter.
- **Validate**: `node --test test/projects.test.mjs` covers list/detail/team/404/401/405/503.

### Task 6: Wire into `poller.mjs`
- **Action**: After fetch/build, also `buildProjects` + write `watchog:projects` as a
  third delivery channel (attempt-all, fail-if-any). `--dry-run` prints the projects doc.
- **Mirror**: `poller.mjs` `Promise.allSettled` block.
- **Validate**: `npm run dry` prints the projects document using only `HULY_*`.

### Task 7: Routing, docs, milestone
- **Action**: Add the three rewrites to `vercel.json`; document endpoints + shapes in
  `README.md`; add a Milestone 3 row to the PRD.
- **Validate**: `curl` each endpoint with the bearer token after a refresh + deploy.

## Validation
```bash
node --test                 # all suites incl. projects
npm run dry                 # prints the projects document (only HULY_*)
npm run once                # writes watchog:summary AND watchog:projects
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/projects
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/projects/<id>
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/projects/<id>/team
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Project member/lead ref model unknown (Account vs PersonId vs Person) | High | Task 1 probe first; isolate in `lib/huly.mjs`; resolve via SocialIdentity if needed; degrade to ids |
| Private projects invisible to the poller login | Medium | Document the coverage caveat; consider a dedicated service account (open PRD question) |
| Team member emails are PII over the API | Medium | Bearer-gated, HTTPS only; documented; can omit emails from `/team` if desired |
| Store key growth / extra cron writes | Low | Separate `watchog:projects` key; attempt-all-fail-if-any keeps writes independent |
| Snapshot staleness for project data | Low | `generatedAt` + `stale` flag, same as `/summary` |
| Auth refactor regresses `/summary` | Low | Extract behind tests; existing `api.test.mjs` must stay green |

## Acceptance
- [ ] All tasks complete
- [ ] `node --test` passes (summary + projects suites)
- [ ] `npm run dry` prints the projects document
- [ ] `npm run once` writes both `watchog:summary` and `watchog:projects`
- [ ] `/projects`, `/projects/{id}`, `/projects/{id}/team` return correct data, 404 on unknown id
- [ ] Team members carry the same person `id` + email fields as `/summary`
- [ ] Patterns: Huly access isolated + verified; builders pure and tested; auth shared via `lib/apiauth.mjs`
