type Cache = { value: boolean; expiresAt: number }

export function withAvailabilityCache(
  fn: () => Promise<boolean>,
  ttlMs: number,
): () => Promise<boolean> {
  let cache: Cache | null = null

  return async () => {
    if (cache && Date.now() < cache.expiresAt) {
      return cache.value
    }

    try {
      const value = await fn()
      cache = { value, expiresAt: Date.now() + ttlMs }
      return value
    } catch {
      return false
    }
  }
}
