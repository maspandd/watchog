# Plan: Huly Monitoring Poller — Milestone 1 (Telegram POC)

**Source PRD**: `.claude/prds/huly-kpi-poller.prd.md`
**Selected Milestone**: #1 — Telegram POC
**Complexity**: Medium (greenfield + external SDK whose exact surface must be verified at build time)

## Summary
Build a small Node.js script that connects to the self-hosted Huly instance,
counts each person's cards aggregated across all projects (total / done / open),
and sends one compact summary message to a Telegram bot. Run it on a daily
schedule via GitHub Actions. This is monitoring/visibility only — no KPI logic,
no monitoring-app POST (that's Milestone 2).

## Patterns to Mirror
| Category | Source | Pattern |
|---|---|---|
| Naming | — | No existing code. New convention: `huly-poller/` folder, ESM (`.mjs`), `camelCase` functions, single-purpose modules. |
| Errors | — | No existing code. New convention: fail loud — throw on missing env / connection failure, non-zero exit so the CI run goes red; never send a partial/empty Telegram message silently. |
| Logging | — | No existing code. New convention: `console.log` for progress, `console.error` for failures; log counts summary before sending. |
| Data access | — | No existing code. Read-only via `@hcengineering/api-client`; no write-back. |
| Tests | — | No existing code. New convention: `node:test` (built-in, zero deps) for the pure aggregation function only; SDK/Telegram I/O validated manually via `--once`. |

> Honest note: the exact `@hcengineering/api-client` API surface (connect
> signature, issue class, status-category field, person lookup) **must be
> verified against the installed package version** in Task 2 before relying on
> it. The shapes below are the expected design; treat them as "verify, then
> implement," not as confirmed fact.

## Files to Change
| File | Action | Why |
|---|---|---|
| `huly-poller/package.json` | CREATE | Declare ESM, deps (`@hcengineering/api-client`, `dotenv`), and `start`/`once` scripts |
| `huly-poller/.gitignore` | CREATE | Keep `.env` and `node_modules` out of git |
| `huly-poller/.env.example` | CREATE | Document required env vars without secrets |
| `huly-poller/lib/aggregate.mjs` | CREATE | Pure function: issues → per-person {total, done, open}. Unit-testable, no I/O |
| `huly-poller/lib/huly.mjs` | CREATE | Connect to Huly, fetch issues + statuses + persons (read-only) |
| `huly-poller/lib/telegram.mjs` | CREATE | Format + send the summary message |
| `huly-poller/poller.mjs` | CREATE | Entry point: wire huly → aggregate → telegram; `--once` flag; env validation |
| `huly-poller/test/aggregate.test.mjs` | CREATE | `node:test` cases for the counting rules |
| `huly-poller/.github/workflows/poller.yml` | CREATE | Daily cron + manual dispatch, injects secrets |
| `huly-poller/README.md` | CREATE | Setup, env vars, run, deploy, and the counting-rule decisions |

## Baked-in Defaults (from PRD decisions)
- **Counting rule**: resolve each issue's status → status *category*.
  `done` = Done category. `open` = everything that is **not** Done and **not**
  Cancelled (Backlog/Todo/In Progress). **Cancelled is excluded entirely**
  (neither done nor open). `total = done + open`.
- **Per-person**: aggregate across all projects; each card counted once, keyed
  by assignee ref. Names resolved via person lookup.
- **Unassigned cards**: skipped for the POC (logged as a count, not itemized).
- **Output**: only people with `open > 0`, sorted by `open` descending; compact
  one-line-per-person format. Footer line shows totals + skipped/unassigned.
- **Cadence**: daily, **08:00 GMT+7 → cron `0 1 * * *` (01:00 UTC)** in Actions.
  Configurable; `--once` for manual/local runs. (GitHub cron is UTC; README
  notes the GMT+7 conversion.)

## Tasks

### Task 1: Scaffold the project
- **Action**: Create `huly-poller/` with `package.json` (`"type": "module"`,
  scripts `once: node poller.mjs --once`, `test: node --test`), `.gitignore`
  (`.env`, `node_modules`), and `.env.example` listing: `HULY_URL`,
  `HULY_EMAIL`, `HULY_PASSWORD`, `HULY_WORKSPACE`, `TELEGRAM_BOT_TOKEN`,
  `TELEGRAM_CHAT_ID`.
- **Mirror**: New convention (no existing code).
- **Validate**: `cd huly-poller && npm install` succeeds.

### Task 2: Huly data access (`lib/huly.mjs`) — VERIFY SDK FIRST
- **Action**: After `npm install`, inspect the installed `@hcengineering/api-client`
  (its exports / types) to confirm: connect signature, the issue class
  (expected `tracker.class.Issue`), the assignee field, how to read a status's
  category (expected via `core.class.Status.category`), and person lookup
  (expected `contact.class.Person`). Then implement `connectHuly()` returning a
  client, and `fetchIssues()` returning `{ issues, statusById, personById }`.
  Read-only.
- **Mirror**: New convention; fail loud on connect/auth error.
- **Validate**: a temporary debug run logs a non-zero issue count and a sample
  issue's assignee + resolved status category.

### Task 3: Aggregation (`lib/aggregate.mjs`)
- **Action**: Pure function `aggregate(issues, statusById, personById)` →
  `{ rows: [{id, name, total, done, open}], unassigned, skipped }` applying the
  counting rule above. No I/O, fully deterministic.
- **Mirror**: New convention; pure/testable.
- **Validate**: `node --test test/aggregate.test.mjs` passes.

### Task 4: Aggregation tests (`test/aggregate.test.mjs`)
- **Action**: `node:test` cases with synthetic fixtures: Done counts as done;
  Cancelled excluded from both; In Progress/Todo/Backlog count as open; a
  person with cards in two projects aggregates to one row; unassigned tallied
  separately; empty input yields empty rows.
- **Mirror**: New convention.
- **Validate**: `node --test` green.

### Task 5: Telegram formatter + sender (`lib/telegram.mjs`)
- **Action**: `formatSummary(result)` → compact string (only `open > 0`, sorted
  by open desc, footer totals). `sendTelegram(text)` POSTs to
  `https://api.telegram.org/bot<token>/sendMessage` (built-in `fetch`). Throw on
  non-200; never send empty/partial.
- **Mirror**: New convention; fail loud.
- **Validate**: `formatSummary` covered by a quick assertion; live send proven
  in Task 6.

### Task 6: Entry point + local run (`poller.mjs`)
- **Action**: Validate required env (throw listing any missing), wire
  huly → aggregate → telegram, support `--once`. Log the computed counts before
  sending.
- **Mirror**: New convention.
- **Validate**: with a real `.env`, `npm run once` delivers a correct-looking
  message to Telegram; glance-check 2-3 people against Huly.

### Task 7: GitHub Actions schedule (`.github/workflows/poller.yml`)
- **Action**: Workflow with `workflow_dispatch` + `schedule` (`0 1 * * *` =
  08:00 GMT+7), Node setup, `npm ci`, `node poller.mjs --once`, env mapped from
  repo secrets.
- **Mirror**: New convention.
- **Validate**: manual `workflow_dispatch` run succeeds end-to-end in CI; next
  scheduled run fires on its own.

### Task 8: README
- **Action**: Document env vars, local run, secrets/deploy steps, the counting
  decisions (Done/Cancelled/unassigned), and how to change the cron time for the
  EM's timezone.
- **Mirror**: New convention.
- **Validate**: a fresh reader can set up and run from the README alone.

## Validation
```bash
# from huly-poller/
npm install
node --test                 # aggregation unit tests pass
npm run once                # delivers a correct-looking Telegram summary (needs real .env)
# then: trigger the GitHub Actions workflow manually and confirm a CI run delivers the message
```

## Risks
| Risk | Likelihood | Mitigation |
|---|---|---|
| `@hcengineering/api-client` API differs from assumed shape | Medium | Task 2 verifies the installed package before building on it; isolate all SDK calls in `lib/huly.mjs` |
| Status→category mapping mislabels "done" | Medium | Drive off status *category*, not status name; glance-check against Huly; documented default |
| ~50-person message is unreadable | Medium | Only `open > 0`, sorted by open desc, compact format |
| Cron time wrong for EM's timezone (Actions is UTC) | Medium | README documents UTC→local conversion; keep time easy to edit |
| Personal credentials in CI secrets ("acts as you") | Medium | Out of scope to fix here; flagged as PRD open question; secrets scoped to the private repo |
| Telegram 4096-char message limit exceeded | Low | Compact format keeps well under; if needed, chunk later |

## Acceptance
- [ ] All tasks complete
- [ ] `node --test` passes (aggregation rules verified)
- [ ] A real `npm run once` delivers a correct-looking per-person summary to Telegram
- [ ] A GitHub Actions run delivers the same message end-to-end on schedule
- [ ] Counting decisions (Done/Cancelled/unassigned) documented in README
- [ ] Patterns: SDK access isolated in one module; aggregation pure and tested
