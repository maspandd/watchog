# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`watchog` (internal codename `huly-poller`) connects to a self-hosted [Huly](https://huly.io)
instance, aggregates card counts per person across all projects, and posts one compact
summary to a Telegram chat. It runs **once per invocation and exits** — scheduling is
external (GitHub Actions cron). This is the Telegram POC (Milestone 1); posting to a
monitoring app's API is a deliberately deferred later milestone.

## Commands

```bash
npm test          # aggregation unit tests via node --test (no network, no env needed)
npm run dry       # connect to Huly and PRINT the summary; needs only HULY_* vars (--dry-run)
npm run once      # connect to Huly and SEND one Telegram summary; needs all env vars
npm start         # same as `once` without the --once flag

node --test test/aggregate.test.mjs   # run a single test file
```

Use `npm run dry` as the primary local dev loop: it exercises the real Huly connection
and the counts without needing Telegram credentials or sending a message.

## Environment

Copy `.env.example` to `.env` and fill in real values. Loaded via `dotenv/config` at the
top of `poller.mjs`. `--dry-run` only requires the four `HULY_*` vars; a normal run also
requires `TELEGRAM_BOT_TOKEN` and `TELEGRAM_CHAT_ID`. Missing vars fail fast in
`requireEnv()` before any network call.

## Architecture

The data flow is a strict one-way pipeline, one module per stage, wired together in
`poller.mjs`:

```
poller.mjs → lib/huly.mjs (fetch) → lib/aggregate.mjs (pure) → lib/telegram.mjs (format + send)
```

- **`lib/huly.mjs`** — the *only* place that knows the Huly SDK. It fetches three things
  (`IssueStatus`, `Person`, `Issue`) read-only and flattens them into plain data:
  `{ issues, statusStateById, personNameById }`. Keep all `@hcengineering/api-client`
  specifics quarantined here.
- **`lib/aggregate.mjs`** — pure, I/O-free function so it is deterministically unit-testable.
  Turns the flat issue list into per-person rows plus footer totals.
- **`lib/telegram.mjs`** — `formatSummary()` (pure, also tested indirectly) and
  `sendTelegram()` (the only outbound HTTP). Fails loud on a non-OK Telegram response.

### Status classification (the core domain logic)

Cards are classified by status **category**, not status name, so the mapping survives a
Huly upgrade. `stateOf()` in `lib/huly.mjs` maps a category id to `'done' | 'cancelled' | 'open'`,
matching **both** the generic `task:statusCategory:*` ids (this instance: `Won`/`Lost`) and
the `tracker:statusCategory:*` ids (`Completed`/`Cancelled`).

Counting rules (enforced in `aggregate.mjs`, asserted in tests):
- **Cancelled** cards are *excluded entirely* — surfaced only as a footer count.
- **Unassigned** cards are *skipped* — surfaced only as a footer count.
- **Unknown** status defaults to `open` so nothing is silently dropped.
- The Telegram message lists **only people with open cards**, sorted by most-open-first;
  footer totals are recomputed from that same filtered set so they always reconcile.

To change Cancelled handling, edit `stateOf()` in `lib/huly.mjs` **and** the exclusion
branch in `lib/aggregate.mjs` together.

### SDK gotchas

- `@hcengineering/api-client` is **CommonJS**; named ESM imports don't work. Destructure
  off the default import: `const { connect, NodeWebSocketFactory } = apiClient`.
- `connect()` must be passed `socketFactory: NodeWebSocketFactory` — Node has no global
  `WebSocket`, and omitting it throws `ReferenceError: WebSocket is not defined` at runtime.
- Huly stores `Person.name` as `"Last,First"`; `nameOf()` normalizes it to `"First Last"`.

## Deployment

`.github/workflows/poller.yml` runs `node poller.mjs --once` on a cron of `0 1 * * *`
(01:00 UTC = 08:00 GMT+7) and on manual `workflow_dispatch`. It uses Node 24 and `npm ci`,
so `package-lock.json` must stay committed. All env vars come from GitHub Actions secrets.
Both `package.json` (`engines.node >=24`) and CI (Node 24) are aligned on Node 24.
