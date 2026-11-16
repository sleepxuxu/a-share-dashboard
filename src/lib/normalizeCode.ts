export function normalizeCode(raw: string): string | null {
  const s = raw.trim().toUpperCase()
  if (/^SH6\d{5}$/.test(s) || /^SZ[03]\d{5}$/.test(s)) return s
  if (/^6\d{5}$/.test(s)) return `SH${s}`
  if (/^[03]\d{5}$/.test(s)) return `SZ${s}`
  return null
}
