// Shared helpers for the bearer-authenticated pull APIs (summary, projects).
// Pure and runtime-agnostic so handlers stay unit-testable; kept here so the
// auth/json/staleness logic lives in exactly one place (DRY).

const DEFAULT_STALE_MS = 90 * 60 * 1000 // 90 min; older data is flagged stale

// Constant-time string compare so token checks don't leak via timing.
export function safeEqual(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string' || a.length !== b.length) return false
  let diff = 0
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i)
  return diff === 0
}

// True only when a token is configured AND the header matches it exactly.
export function authorize(authHeader, token) {
  return Boolean(token) && safeEqual(authHeader, `Bearer ${token}`)
}

// Uniform JSON response envelope returned by every handler.
export function json(status, body) {
  return { status, headers: { 'content-type': 'application/json' }, body }
}

// Derive the stale flag from an ISO `generatedAt`. Unparseable/missing -> stale.
export function isStale(generatedAt, now, windowMs = DEFAULT_STALE_MS) {
  const ms = generatedAt ? Date.parse(generatedAt) : NaN
  return Number.isFinite(ms) ? now - ms > windowMs : true
}
