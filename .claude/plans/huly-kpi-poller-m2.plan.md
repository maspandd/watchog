# Plan: Huly Monitoring Poller — Milestone 2 (Exposed summary API)

**Source PRD**: `.claude/prds/huly-kpi-poller.prd.md`
**Selected Milestone**: #2 — Summary API
**Complexity**: Medium–Large (serverless surface + external snapshot store + two new Huly fields — project and email — that must be verified against the SDK)

## Summary
Expose the per-person total/done/open summary as an **HTTP API other apps pull** (not a
push). Two read endpoints: `GET /summary` (full roster) and `GET /summary/{id}` (one
person). Each person row now also carries the Huly **person id**, **email**, and the
**projects** on the workspace they hold cards in. The existing run-once cron keeps
sending Telegram **and** now writes the latest summary as a JSON snapshot to an external
store; a bearer-authenticated serverless function serves it. Consumers never wait on Huly.

## Confirmed decisions (this session)
| Decision | Choice |
|---|---|
| Direction | **Pull** — watchog exposes the API; other apps consume (PRD updated) |
| Endpoints | `GET /summary` (all) **and** `GET /summary/{id}` (per person) |
| Per-person fields | `id` (Huly person `_id`), `name`, **`email`**, `open`/`done`/`total`, **`projects[]`** |
| Data source | **Cached snapshot** — cron writes snapshot; API serves it (no Huly per request) |
| Hosting | **Serverless** (recommend Vercel Node runtime) |
| Auth | **Bearer token** (`Authorization: Bearer <token>`; 401 otherwise) |
| Telegram | **Keep both** — Telegram daily message unchanged; API is additional |

## Verify-first against the installed SDK (before building on these)
Two new fields are "if we can get from Huly" — confirm the exact SDK surface first, the
same way M1 verified the issue/status shape. Isolate all of this in `lib/huly.mjs`:
1. **Project / space** — each issue's `space` ref points at its `tracker:class:Project`;
   fetch projects, map `space._id -> { name, identifier }`. Confirm the class id and the
   name/identifier fields on the installed version.
2. **Email** — Huly stores email as a `contact:class:Channel` doc (`attachedTo = person._id`,
   `provider = contact:channelProvider:Email`, `value = address`), **not** a field on
   `Person`. Fetch email channels, map `person._id -> email`. Confirm the channel class
   and the email provider id. If unavailable, email degrades to `null` (logged), not a crash.

## Architecture
```
GitHub Actions cron (run-once, as today)
  Huly -> fetchData (issues + statuses + persons + projects + emails)
       -> aggregate() -> formatSummary() -> Telegram            (M1 path, unchanged output)
       -> buildSnapshot() -> putSnapshot() --> [external KV store]
                                                     |
Consumer  GET /summary        (Bearer) --> fn --getSnapshot--> 200 full roster
Consumer  GET /summary/{id}   (Bearer) --> fn --getSnapshot--> 200 one person | 404
```
The per-person endpoint needs **no extra store**: the snapshot already holds every person
keyed by id, so `/summary/{id}` just indexes into it (404 if absent).

## Remaining sub-decisions (defaults chosen; override anytime)
1. **Platform**: recommend **Vercel (Node runtime)** so `api/` reuses the Node ESM `lib/`
   and `node --test` as-is (Cloudflare Workers run on non-Node workerd).
2. **Snapshot store**: default **Vercel KV / Upstash Redis REST**, HTTP-reachable from both
   GitHub Actions and the function. Single key `watchog:summary`.
3. **`projects[]` shape**: per-project breakdown `{ id, name, open, done, total }` (more
   useful for a dashboard than a bare name list — we iterate issues anyway).
4. **Staleness**: response includes `generatedAt`; older than 90 min adds `"stale": true`.

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| SDK isolation + verify-first | `lib/huly.mjs:48-62`, M1 plan's "verify SDK first" | All Huly class ids / field reads live in `lib/huly.mjs`; confirm shape before relying on it |
| Naming | `lib/telegram.mjs` | Single-purpose ESM modules, `camelCase` exports. New: `lib/snapshot.mjs`, `lib/store.mjs`, `api/summary.mjs` |
| HTTP / fetch / throw | `lib/telegram.mjs:32-44` | Built-in `fetch`, check `res.ok`, throw with status + body. `store.mjs` follows this |
| Pure + testable core | `lib/aggregate.mjs`, `test/aggregate.test.mjs` | I/O-free fn, `node:test` + `node:assert/strict`, synthetic fixtures. `buildSnapshot` and `handleSummary` core follow this |
| Env validation | `poller.mjs:15-24` | Per-mode required-var arrays; `requireEnv()` collects all missing and throws one message |
| Dry-run | `poller.mjs:13,48-52` | `--dry-run` prints instead of sending; relaxes that channel's env requirement |
| Fail-loud top level | `poller.mjs:65-68` | `catch -> console.error('Poller failed:') -> process.exit(1)` |

## Files to Change
| File | Action | Why |
|---|---|---|
| `lib/huly.mjs` | UPDATE | Also fetch projects (`space._id -> name`) and email channels (`person._id -> email`); include `space` on each issue; return `projectNameById`, `personEmailById` |
| `lib/aggregate.mjs` | UPDATE | Carry `email` per person and a per-project breakdown (`projects[]`) keyed by space; counts per project |
| `lib/snapshot.mjs` | CREATE | Pure `buildSnapshot(result, {generatedAt})` -> the API document (people with id/name/email/counts/projects) |
| `lib/store.mjs` | CREATE | `putSnapshot` / `getSnapshot` over the configured KV store (only IO; provider-swappable) |
| `api/summary.mjs` | CREATE | Serverless handler: pure `handleSummary({method, path, authHeader}, {snapshot, token, now})` core (routes `/summary` and `/summary/{id}`) + thin platform export |
| `poller.mjs` | UPDATE | After aggregate, also `buildSnapshot` + `putSnapshot` alongside Telegram; `--dry-run` prints the snapshot JSON |
| `test/aggregate.test.mjs` | UPDATE | Add cases for email passthrough and per-project breakdown |
| `test/snapshot.test.mjs` | CREATE | `buildSnapshot` shape/reconcile/empty + projects/email present |
| `test/api.test.mjs` | CREATE | `handleSummary`: 200 roster, 200 single, 404 unknown id, 401 bad token, 405 non-GET, 503 no-snapshot, `stale` flag |
| `.env.example` | UPDATE | Add `API_TOKEN`, `SNAPSHOT_STORE_URL`, `SNAPSHOT_STORE_TOKEN` |
| `.github/workflows/poller.yml` | UPDATE | Map the snapshot-store secrets into the cron run env |
| `vercel.json` | CREATE | Route `/summary` and `/summary/:id` -> `api/summary.mjs` (if Vercel) |
| `README.md` | UPDATE | Document both endpoints, bearer auth, response shape (id/email/projects), freshness, store + deploy setup |

## Response contract (default — confirm field names)
`GET /summary` with `Authorization: Bearer <API_TOKEN>`:
```json
{
  "generatedAt": "2026-06-30T01:00:00.000Z",
  "source": "watchog",
  "stale": false,
  "people": [
    {
      "id": "<huly person _id>",
      "name": "Jane Doe",
      "email": "jane@example.com",
      "open": 2, "done": 1, "total": 3,
      "projects": [
        { "id": "<space _id>", "name": "High-Code", "open": 1, "done": 1, "total": 2 },
        { "id": "<space _id>", "name": "OutSystems", "open": 1, "done": 0, "total": 1 }
      ]
    }
  ],
  "totals": { "people": 1, "open": 2, "done": 1, "total": 3 },
  "unassigned": 0,
  "cancelled": 0
}
```
`GET /summary/{id}` returns a single `people[]` element (the object above) for that Huly
person id, or **404** if the id isn't in the current snapshot.
- `id` is the stable Huly person `_id` for consumer-side mapping; `email` is `null` if Huly
  has no email channel for that person.
- Includes **all** people rows (Telegram lists only `open > 0`); consumers filter.
- `401` missing/wrong token; `405` non-GET; `503` if no snapshot has been written yet.

## Tasks
### Task 1: `lib/huly.mjs` — fetch project + email (VERIFY SDK FIRST)
- **Action**: Confirm the project class/fields and email-channel class/provider on the
  installed `@hcengineering/api-client`. Add fetches: projects -> `projectNameById`,
  email channels -> `personEmailById`; include `space` on each mapped issue. Email/project
  absent -> `null` (logged), never a crash. Read-only.
- **Mirror**: `lib/huly.mjs:48-62` (existing `fetchData`) for the fetch+map shape.
- **Validate**: a temporary debug run logs a sample issue's `space` -> project name and a
  sample person's resolved email.

### Task 2: `lib/aggregate.mjs` — email + per-project breakdown
- **Action**: Extend the per-person row with `email` (from `personEmailById`) and a
  `projects` array: for each issue, bucket by `space` into `{ id, name, open, done, total }`;
  person-level `open/done/total` stay the sum across projects. Keep it pure.
- **Mirror**: existing `aggregate` accumulation (`lib/aggregate.mjs:15-60`).
- **Validate**: `node --test test/aggregate.test.mjs` passes (incl. new cases).

### Task 3: `test/aggregate.test.mjs` — new cases
- **Action**: Add fixtures with `space` + an email map: a person with cards in two
  projects yields two `projects[]` entries whose counts sum to the person totals; email is
  passed through; missing email -> `null`.
- **Mirror**: `test/aggregate.test.mjs` structure/assertions.
- **Validate**: `node --test` green.

### Task 4: `lib/snapshot.mjs` + `test/snapshot.test.mjs`
- **Action**: Pure `buildSnapshot(result, { generatedAt })` -> the response document
  (people with id/name/email/counts/projects, totals, unassigned, cancelled, source).
- **Mirror**: `lib/telegram.mjs:3-30` (pure builder).
- **Validate**: `node --test test/snapshot.test.mjs` passes.

### Task 5: `lib/store.mjs` — snapshot put/get (the only new IO)
- **Action**: `putSnapshot(snapshot)` / `getSnapshot()` via `fetch` against the KV store
  (Vercel KV / Upstash REST), env `SNAPSHOT_STORE_URL` + `SNAPSHOT_STORE_TOKEN`; throw on
  `!res.ok`; `getSnapshot` returns `null` when the key is absent.
- **Mirror**: `lib/telegram.mjs:32-44`.
- **Validate**: a temporary `put` then `get` round-trips the same object.

### Task 6: `api/summary.mjs` + `test/api.test.mjs` — handler (pure core + adapter)
- **Action**: Pure `handleSummary({ method, path, authHeader }, { snapshot, token, now })`
  -> `{ status, headers, body }`: GET-only, bearer check (constant-time), route `/summary`
  (full) vs `/summary/{id}` (one, 404 if absent), 503 when snapshot null, `stale` flag.
  Thin platform export wires the request in and calls `getSnapshot()`.
- **Mirror**: `lib/aggregate.mjs` purity.
- **Validate**: `node --test test/api.test.mjs` covers 200 roster / 200 single / 404 / 401 /
  405 / 503 / stale.

### Task 7: Wire snapshot write into `poller.mjs`
- **Action**: Add `STORE_VARS = ['SNAPSHOT_STORE_URL','SNAPSHOT_STORE_TOKEN']` to the
  non-dry-run required set. After `aggregate`, `buildSnapshot` then `putSnapshot` **in
  addition to** the Telegram send (attempt both; exit non-zero if either fails).
  `--dry-run` prints the snapshot JSON, needs only `HULY_*`.
- **Mirror**: `poller.mjs:15-24`, `:46-59`, `:65-68`.
- **Validate**: `npm run dry` prints Telegram text + snapshot JSON with only `HULY_*`.

### Task 8: Config, deploy, docs
- **Action**: Add the three new vars to `.env.example`; add store secrets to `poller.yml`;
  add `vercel.json` routing for both endpoints; document endpoints/auth/response (id/email/
  projects)/freshness and store + deploy steps in `README.md`.
- **Mirror**: existing `.env.example` and `poller.yml` env mapping.
- **Validate**: a reader can deploy, set secrets, and `curl` both endpoints with the token.

## Validation
```bash
node --test                 # aggregate + snapshot + api suites pass (no network)
npm run dry                 # prints Telegram text AND snapshot JSON (id/email/projects); only HULY_*
npm run once                # real run: Telegram send + snapshot written to the store
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/summary           # full roster
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/summary/<personId> # one person
curl https://<deploy>/summary                                                  # 401 without token
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| Email not on `Person` (lives in Channel) — fetch shape wrong | Medium | Task 1 verifies the channel class/provider before building; degrade to `null`, never crash |
| Project/space field differs on installed Huly | Medium | Verify-first in Task 1; isolate in `lib/huly.mjs`; `projects[]` optional if unavailable |
| Snapshot store choice/cost/lock-in | Medium | Isolate behind `lib/store.mjs`; env-driven; HTTP KV reachable by both cron and function |
| Platform runtime mismatch (CF Workers != Node) | Medium | Keep `handleSummary` pure; recommend Vercel Node runtime |
| Stale data if cron stalls | Medium | `generatedAt` + `stale` flag; README documents the freshness window |
| Bearer token leakage / weak compare | Medium | Constant-time compare; token only in env/secrets; never logged; HTTPS only |
| Partial delivery (Telegram ok, snapshot fails) | Medium | Attempt both, exit non-zero if either fails |
| Email is PII now leaving Huly via the API | Medium | Bearer-gated, HTTPS only; documented; consider omitting email when token scope is broad |
| Personal Huly credentials in CI ("acts as you") | Medium | Unchanged from M1; still a PRD open question; secrets scoped to private repo |

## Acceptance
- [ ] All tasks complete
- [ ] `node --test` passes (aggregate + snapshot + api suites)
- [ ] `npm run dry` prints snapshot JSON with `id`, `email`, and per-person `projects[]`
- [ ] A real `npm run once` writes the snapshot **and** still sends Telegram
- [ ] `GET /summary` returns the full roster; `GET /summary/{id}` returns one person (404 if unknown)
- [ ] Each person row carries the Huly person `id`, `email` (or `null`), and `projects[]`
- [ ] Valid bearer token required; 401 without; response has `generatedAt` + working `stale`
- [ ] Patterns: Huly fields verified + isolated in one module; `buildSnapshot`/`handleSummary` pure and tested
