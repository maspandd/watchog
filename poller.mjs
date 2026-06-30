// Entry point: connect to Huly -> aggregate -> deliver.
// Runs once and exits (scheduling is external, via GitHub Actions cron).
//
// Delivery channels (both attempted every run):
//   1. Telegram  - the compact human summary (Milestone 1).
//   2. Snapshot  - the full JSON document written to the store that backs the
//                  Summary API (Milestone 2). The API reads it; consumers pull.
//
// Flags:
//   --once      accepted for clarity; running once is the only mode.
//   --dry-run   print the summary and the JSON snapshot to the console instead
//               of sending (and skip the Telegram + store env requirement).
import 'dotenv/config'
import { connectHuly, fetchData } from './lib/huly.mjs'
import { aggregate } from './lib/aggregate.mjs'
import { formatSummary, sendTelegram } from './lib/telegram.mjs'
import { buildSnapshot } from './lib/snapshot.mjs'
import { putSnapshot } from './lib/store.mjs'

const dryRun = process.argv.includes('--dry-run')

const HULY_VARS = ['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD', 'HULY_WORKSPACE']
const TELEGRAM_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']
const STORE_VARS = ['SNAPSHOT_STORE_URL', 'SNAPSHOT_STORE_TOKEN']

function requireEnv() {
  const required = dryRun ? HULY_VARS : [...HULY_VARS, ...TELEGRAM_VARS, ...STORE_VARS]
  const missing = required.filter((k) => !process.env[k])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }
}

async function main() {
  requireEnv()

  const client = await connectHuly({
    url: process.env.HULY_URL,
    email: process.env.HULY_EMAIL,
    password: process.env.HULY_PASSWORD,
    workspace: process.env.HULY_WORKSPACE,
  })

  try {
    const data = await fetchData(client)
    const result = aggregate(
      data.issues,
      data.statusStateById,
      data.personNameById,
      data.projectNameById,
      data.loginEmailById,
      data.contactEmailById,
    )

    console.log(
      `Aggregated ${result.totals.people} people, ${result.totals.open} open, ` +
        `${result.totals.done} done, ${result.cancelled} cancelled (excluded), ` +
        `${result.unassigned} unassigned (skipped).`,
    )

    const generatedAt = new Date()
    const text = formatSummary(result, { generatedAt })
    const snapshot = buildSnapshot(result, { generatedAt })

    if (dryRun) {
      console.log('\n--- dry run: nothing sent ---\n')
      console.log(text)
      console.log('\n--- snapshot payload (served by the Summary API) ---\n')
      console.log(JSON.stringify(snapshot, null, 2))
      return
    }

    // Attempt both channels even if one fails, then fail the run if either did,
    // so a store outage never silently suppresses Telegram (and vice versa).
    const outcomes = await Promise.allSettled([
      sendTelegram(process.env.TELEGRAM_BOT_TOKEN, process.env.TELEGRAM_CHAT_ID, text),
      putSnapshot(snapshot),
    ])
    const labels = ['Telegram', 'Snapshot store']
    const failures = outcomes
      .map((o, i) => ({ o, label: labels[i] }))
      .filter(({ o }) => o.status === 'rejected')
    for (const { o, label } of failures) console.error(`${label} delivery failed:`, o.reason)
    if (failures.length > 0) {
      throw new Error(`${failures.length} of ${outcomes.length} delivery channel(s) failed`)
    }

    console.log('Telegram summary sent; snapshot published for the Summary API.')
  } finally {
    if (typeof client.close === 'function') await client.close()
  }
}

main().catch((err) => {
  console.error('Poller failed:', err)
  process.exit(1)
})
