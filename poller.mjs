// Entry point: connect to Huly -> aggregate -> send one Telegram summary.
// Runs once and exits (scheduling is external, via GitHub Actions cron).
//
// Flags:
//   --once      accepted for clarity; running once is the only mode.
//   --dry-run   print the summary to the console instead of sending to
//               Telegram (and skip the Telegram env-var requirement).
import 'dotenv/config'
import { connectHuly, fetchData } from './lib/huly.mjs'
import { aggregate } from './lib/aggregate.mjs'
import { formatSummary, sendTelegram } from './lib/telegram.mjs'

const dryRun = process.argv.includes('--dry-run')

const HULY_VARS = ['HULY_URL', 'HULY_EMAIL', 'HULY_PASSWORD', 'HULY_WORKSPACE']
const TELEGRAM_VARS = ['TELEGRAM_BOT_TOKEN', 'TELEGRAM_CHAT_ID']

function requireEnv() {
  const required = dryRun ? HULY_VARS : [...HULY_VARS, ...TELEGRAM_VARS]
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
    const result = aggregate(data.issues, data.statusStateById, data.personNameById)

    console.log(
      `Aggregated ${result.totals.people} people, ${result.totals.open} open, ` +
        `${result.totals.done} done, ${result.cancelled} cancelled (excluded), ` +
        `${result.unassigned} unassigned (skipped).`,
    )

    const text = formatSummary(result, { generatedAt: new Date() })

    if (dryRun) {
      console.log('\n--- dry run: summary not sent to Telegram ---\n')
      console.log(text)
      return
    }

    await sendTelegram(
      process.env.TELEGRAM_BOT_TOKEN,
      process.env.TELEGRAM_CHAT_ID,
      text,
    )
    console.log('Telegram summary sent.')
  } finally {
    if (typeof client.close === 'function') await client.close()
  }
}

main().catch((err) => {
  console.error('Poller failed:', err)
  process.exit(1)
})
