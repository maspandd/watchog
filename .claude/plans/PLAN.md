# Huly Card Poller → Telegram + Monitoring App

**Plan & Setup Checklist**

## Goal

Track how many cards (issues) each employee has in Huly, and how many are
done, then automatically push that summary to:
1. A Telegram bot
2. A custom monitoring web app (once its API endpoint exists)

Running on a schedule, with no server to manage.

---

## Architecture

```
GitHub Actions (hourly cron)
        │
        ▼
   poller.mjs  ──► connects to Huly via @hcengineering/api-client
        │
        ├──► counts cards per employee (total / done / open)
        │
        ├──► sends text summary  ──► Telegram bot
        │
        └──► sends JSON payload  ──► your monitoring app's API (optional)
```

- **Huly instance**: `https://ppuboard.devoutsys.com` — confirmed
  publicly reachable, no VPN/LAN restriction.
- **Runtime**: Node.js script, run via GitHub Actions (free tier, no
  server access needed).
- **Connection method**: Huly's official `@hcengineering/api-client` SDK
  (no real Python SDK exists, which is why this stayed in Node).

---

## Setup Checklist

### 1. Confirm Huly access details
- [ ] Log in to `https://ppuboard.devoutsys.com` in a browser to confirm
      the account/login works normally
- [ ] Note the **workspace slug** from the URL after logging in
      (e.g. `.../workbench/<workspace-name>`)
- [ ] Confirm which account (email) the poller should use — ideally a
      dedicated bot/service account rather than your personal login, if
      Huly supports creating one

### 2. Telegram bot
- [ ] Create bot via **@BotFather** → `/newbot` → copy `TELEGRAM_BOT_TOKEN`
- [ ] Message the bot (or add to a group)
- [ ] Visit `https://api.telegram.org/bot<TOKEN>/getUpdates` to get
      `TELEGRAM_CHAT_ID`

### 3. Local test run (recommended before deploying)
- [ ] `npm install` in the `huly-poller` folder
- [ ] Copy `.env.example` → `.env`, fill in real values
- [ ] Run `node poller.mjs --once`
- [ ] Confirm a message arrives in Telegram with correct employee counts
- [ ] Double-check the "Done" status logic matches your actual workflow
      categories (see README note on `Cancelled` vs `Done`)

### 4. Deploy via GitHub Actions
- [ ] Push the `huly-poller` folder to a **private** GitHub repo
- [ ] Add repo secrets (Settings → Secrets and variables → Actions):
  - `HULY_URL`, `HULY_EMAIL`, `HULY_PASSWORD`, `HULY_WORKSPACE`
  - `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`
  - `MONITORING_API_URL`, `MONITORING_API_TOKEN` (once step 5 is ready)
- [ ] Manually trigger the workflow once from the Actions tab to confirm
      it runs end-to-end in CI (not just locally)
- [ ] Confirm the scheduled run fires on its own at the next hour mark

### 5. Monitoring app integration (when ready on your side)
- [ ] Build an API endpoint on your monitoring app that accepts:
  ```json
  {
    "source": "huly",
    "workspace": "your-workspace-id",
    "generatedAt": "2026-06-29T09:00:00.000Z",
    "employees": [
      { "id": "person-ref-id", "name": "Jane Doe", "total": 12, "done": 7, "open": 5 }
    ]
  }
  ```
- [ ] Decide on auth: bearer token (already supported via
      `MONITORING_API_TOKEN`) or something else — adjust
      `postToMonitoringApi()` in `poller.mjs` if the shape/auth differs
- [ ] Add `MONITORING_API_URL` (+ token) to GitHub secrets
- [ ] Confirm a manual workflow run successfully posts data and your app
      receives/stores it correctly

---

## Open Decisions / Things to Revisit

- **Service account vs. personal login**: using your own email/password
  in a CI secret works but means the poller acts "as you." Worth checking
  if Huly supports a separate bot/service account for this.
- **Done vs. Cancelled**: currently both count as "finished" — confirm
  this matches how you want cancelled cards reported.
- **Unassigned cards**: currently skipped entirely — decide if these
  should show up as a separate "Unassigned" line.
- **Frequency**: hourly by default — adjust the cron schedule in
  `.github/workflows/poller.yml` if you want a different cadence.
- **Monitoring API auth**: confirm exact header/payload format once that
  endpoint exists, since the current script assumes a simple Bearer
  token + JSON POST.

---

## Reference

- Huly self-host repo: `huly-selfhost` (Docker Compose)
- Huly official client: `@hcengineering/api-client`
- No official Python SDK exists for Huly — this is why the project
  stayed Node.js rather than being ported
- Project files: `poller.mjs`, `.env.example`, `package.json`,
  `.github/workflows/poller.yml`, `README.md`
