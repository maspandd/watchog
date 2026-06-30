# watchog

> Internal codename was `huly-poller`; the project is now `watchog`.

Reads card counts per person from a self-hosted [Huly](https://huly.io) instance
and posts a compact summary to a Telegram chat. Runs once per invocation;
scheduling is handled externally by GitHub Actions.

Milestone 1 was the **Telegram POC** (the daily message). Milestone 2 adds a
pull **[Summary API](#summary-api-milestone-2)**: the same run also publishes a
JSON snapshot that a bearer-authenticated serverless endpoint serves, so other
apps (e.g. the EM's monitoring app) can consume it. Both channels run every
invocation.

## What it reports

For each person, aggregated **across all projects**:

- `open`  - cards not done and not cancelled (UnStarted / ToDo / Active)
- `done`  - cards in the "Won" status category (Huly's generic "completed")
- `total` - open + done

Classification is by status **category**, not status name. This instance uses
the `task:statusCategory:*` ids (`Won` = done, `Lost` = cancelled); the code also
accepts the `tracker:statusCategory:*` ids (`Completed`/`Cancelled`) so it keeps
working across Huly versions.

### Counting decisions

- **Cancelled cards are excluded entirely** (not counted as done or open). They
  appear only as a "Cancelled (excluded)" footer count.
- **Unassigned cards are skipped** and shown only as an "Unassigned (skipped)"
  footer count.
- **Unknown status** is treated as `open` so nothing is silently dropped.
- The message lists **only people with open cards**, sorted by most open first.

To change how Cancelled is handled, edit `stateOf()` in `lib/huly.mjs` and the
exclusion branch in `lib/aggregate.mjs`.

## Setup

Requires Node.js >= 24.

```bash
npm install
cp .env.example .env   # then fill in real values
```

### Environment variables

| Var | What |
|---|---|
| `HULY_URL` | e.g. `https://ppuboard.devoutsys.com` |
| `HULY_EMAIL` | account the poller logs in as |
| `HULY_PASSWORD` | that account's password |
| `HULY_WORKSPACE` | workspace slug from `.../workbench/<workspace>` |
| `TELEGRAM_BOT_TOKEN` | from @BotFather |
| `TELEGRAM_CHAT_ID` | from `https://api.telegram.org/bot<TOKEN>/getUpdates` |
| `SNAPSHOT_STORE_URL` | Vercel KV / Upstash Redis REST base URL (cron writes, API reads) |
| `SNAPSHOT_STORE_TOKEN` | bearer token for that store |
| `API_TOKEN` | bearer token consumers send to the API; set on the API host, not the cron |

> Using a personal Huly login means the poller acts "as you". A dedicated
> service account is preferable if your instance supports one (open question
> in the PRD).

## Run locally

```bash
npm test          # aggregation unit tests (no network)
npm run dry       # connect to Huly and PRINT the summary (no Telegram send)
npm run once      # connect to Huly and send one Telegram summary (needs .env)
```

`npm run dry` (the `--dry-run` flag) only needs the four `HULY_*` vars, not the
Telegram or store ones - use it to verify the Huly side and the counts before
wiring up the bot. It prints both the Telegram text **and** the JSON snapshot the
Summary API would serve, so you can eyeball the per-person `email` and `projects`.

Spot-check: after the first send, compare 2-3 people's counts against their
boards in Huly to confirm the status mapping matches your workflow.

## Summary API (Milestone 2)

Other apps pull the summary over HTTP instead of receiving a push. Because the
cron (GitHub Actions) and the API run in different places and can't share a file,
the cron writes the latest summary as a JSON **snapshot** to an external KV store
(`SNAPSHOT_STORE_*`), and a bearer-authenticated serverless function serves it.
Consumers never wait on Huly; data is as fresh as the last cron run.

### Endpoints

All require `Authorization: Bearer <API_TOKEN>`.

| Method | Path | Returns |
|---|---|---|
| `GET` | `/summary` | The full roster snapshot |
| `GET` | `/summary/{id}` | One person by Huly person id (`404` if unknown) |

Responses: `401` (missing/wrong token), `405` (non-GET), `503` (no snapshot yet,
e.g. the cron hasn't run). Each response carries `generatedAt` and a `stale` flag
(`true` once the snapshot is older than 90 minutes).

### Response shape

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
      "loginEmail": "jane@example.com",
      "contactEmail": null,
      "open": 2, "done": 1, "total": 3,
      "projects": [
        { "id": "<space _id>", "name": "High-Code", "open": 1, "done": 1, "total": 2 }
      ]
    }
  ],
  "totals": { "people": 1, "open": 2, "done": 1, "total": 3 },
  "unassigned": 0,
  "cancelled": 0
}
```

- `id` is the stable Huly person `_id` — map your dashboard's people against it.
- Email comes from two independent Huly sources, surfaced separately:
  `loginEmail` (the account/login identity, `contact:class:SocialIdentity`) and
  `contactEmail` (an added contact channel, `contact:class:Channel`). `email` is a
  convenience field = `loginEmail ?? contactEmail`. Any may be `null`.
- `projects` is the per-project breakdown, empty for cards with no project/space.
- Unlike the Telegram message (which lists only people with open cards), the API
  returns **all** people; consumers filter.

### Deploy (Vercel)

The handler lives at `api/summary.mjs` (Vercel Node function) with `vercel.json`
routing `/summary` and `/summary/:id` to it. Set `API_TOKEN`, `SNAPSHOT_STORE_URL`,
and `SNAPSHOT_STORE_TOKEN` in the Vercel project env. The same `SNAPSHOT_STORE_*`
secrets go in GitHub Actions so the cron can write what the function reads.

```bash
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/summary
curl -H "Authorization: Bearer $API_TOKEN" https://<deploy>/summary/<personId>
```

## Deploy (GitHub Actions)

1. Push this folder to a **private** GitHub repo (this folder is the repo root,
   so the workflow lands at `.github/workflows/poller.yml`).
2. Commit `package-lock.json` (the workflow uses `npm ci`).
3. Add repo secrets (Settings -> Secrets and variables -> Actions): `HULY_URL`,
   `HULY_EMAIL`, `HULY_PASSWORD`, `HULY_WORKSPACE`, `TELEGRAM_BOT_TOKEN`,
   `TELEGRAM_CHAT_ID`.
4. Run the workflow once manually (Actions -> Huly Poller -> Run workflow) to
   confirm it works end-to-end.

### Schedule / timezone

The cron is `0 1 * * *` = **01:00 UTC = 08:00 GMT+7**. GitHub cron is always UTC
and can fire a few minutes late under load. To change the time, edit the `cron`
line in `.github/workflows/poller.yml` (subtract 7 hours from your desired local
time to get UTC).