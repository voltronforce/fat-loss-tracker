/**
 * Returns today's date as YYYY-MM-DD in the user's LOCAL timezone.
 *
 * Do NOT use new Date().toISOString().slice(0,10) — that returns the UTC date,
 * which is yesterday for Sydney (UTC+10/+11) in the early hours.
 */
export function todayLocal() {
  const d = new Date()
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}

/**
 * Converts a Date object to YYYY-MM-DD in local time.
 */
export function dateToLocal(d) {
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
}
