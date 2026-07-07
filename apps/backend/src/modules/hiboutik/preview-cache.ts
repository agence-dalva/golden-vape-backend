const TTL_MS = 30 * 60 * 1000 // 30 minutes — le catalogue Hiboutik ne change pas souvent

let cached: { value: unknown; expiresAt: number } | null = null

export function getCachedPreview<T>(): T | null {
  if (!cached || cached.expiresAt < Date.now()) return null
  return cached.value as T
}

export function setCachedPreview(value: unknown) {
  cached = { value, expiresAt: Date.now() + TTL_MS }
}

export function clearCachedPreview() {
  cached = null
}
