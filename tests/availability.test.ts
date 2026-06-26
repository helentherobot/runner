import { describe, it, expect, vi } from 'vitest'
import { withAvailabilityCache } from '../src/index.js'

describe('withAvailabilityCache', () => {
  it('calls the underlying function only once within TTL', async () => {
    const fn = vi.fn().mockResolvedValue(true)
    const cached = withAvailabilityCache(fn, 5000)

    await cached()
    await cached()
    await cached()

    expect(fn).toHaveBeenCalledTimes(1)
  })

  it('re-evaluates after TTL expires', async () => {
    vi.useFakeTimers()

    try {
      const fn = vi.fn().mockResolvedValue(true)
      const cached = withAvailabilityCache(fn, 1000)

      await cached()
      expect(fn).toHaveBeenCalledTimes(1)

      vi.advanceTimersByTime(1001)

      await cached()
      expect(fn).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('returns false on async error and does not cache the error', async () => {
    const fn = vi.fn().mockRejectedValueOnce(new Error('network down')).mockResolvedValueOnce(true)

    const cached = withAvailabilityCache(fn, 5000)

    const first = await cached()
    expect(first).toBe(false)

    // Should retry because errors are not cached
    const second = await cached()
    expect(second).toBe(true)
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
