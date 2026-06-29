// Format the summary and send it to Telegram. Fails loud on a non-OK response.

export function formatSummary(result, { generatedAt } = {}) {
  const { rows, unassigned, cancelled } = result
  // Only show people with open work; the footer totals are derived from the
  // same set so the numbers always reconcile with the listed rows.
  const active = rows.filter((r) => r.open > 0)
  const open = active.reduce((n, r) => n + r.open, 0)
  const done = active.reduce((n, r) => n + r.done, 0)
  const stamp = generatedAt ? generatedAt.toISOString() : ''

  const lines = []
  lines.push(`Huly card summary${stamp ? ` - ${stamp}` : ''}`)
  lines.push('')

  if (active.length === 0) {
    lines.push('No open cards.')
  } else {
    for (const r of active) {
      lines.push(`- ${r.name}: ${r.open} open / ${r.done} done (${r.total} total)`)
    }
  }

  lines.push('')
  lines.push(`Total: ${active.length} people with open work, ${open} open, ${done} done`)
  if (unassigned) lines.push(`Unassigned (skipped): ${unassigned}`)
  if (cancelled) lines.push(`Cancelled (excluded): ${cancelled}`)

  return lines.join('\n')
}

export async function sendTelegram(token, chatId, text) {
  const url = `https://api.telegram.org/bot${token}/sendMessage`
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Telegram API error ${res.status}: ${body}`)
  }
  return res.json()
}
