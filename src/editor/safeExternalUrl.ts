export function safeExternalUrl(value: string): string | null {
  const input = value.trim()
  if (!input) return null
  try {
    const url = new URL(/^[a-z][a-z\d+.-]*:/i.test(input) ? input : `https://${input}`)
    if ((url.protocol !== 'http:' && url.protocol !== 'https:') || !url.hostname || url.username || url.password) return null
    return url.toString()
  } catch { return null }
}
