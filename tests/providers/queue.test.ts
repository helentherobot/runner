import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { ProviderQueue } from '../../src/providers/queue.js'
import type { QueueConfig } from '../../src/types.js'

const baseConfig: QueueConfig = {
  maxConcurrent: 2,
  requestsPerMinute: 0,
  affinityMode: false,
  warmup: false,
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

describe('ProviderQueue — concurrency', () => {
  it('runs at most maxConcurrent calls simultaneously', async () => {
    const queue = new ProviderQueue({ ...baseConfig, maxConcurrent: 2 })

    let concurrent = 0
    let maxSeen = 0

    const task = async () => {
      concurrent++
      maxSeen = Math.max(maxSeen, concurrent)
      await delay(20)
      concurrent--
      return true
    }

    await Promise.all([
      queue.enqueue('a', task),
      queue.enqueue('a', task),
      queue.enqueue('a', task),
      queue.enqueue('a', task),
    ])

    expect(maxSeen).toBe(2)
  })

  it('dispatches queued calls once in-flight slots free up', async () => {
    const queue = new ProviderQueue({ ...baseConfig, maxConcurrent: 1 })
    const order: number[] = []

    await Promise.all([
      queue.enqueue('s', async () => {
        order.push(1)
        await delay(10)
      }),
      queue.enqueue('s', async () => {
        order.push(2)
      }),
    ])

    expect(order).toEqual([1, 2])
  })
})

describe('ProviderQueue — rate limiting', () => {
  beforeEach(() => {
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('staggered dispatch when requestsPerMinute is exceeded', async () => {
    const queue = new ProviderQueue({
      ...baseConfig,
      maxConcurrent: 10,
      requestsPerMinute: 2,
    })

    const dispatchTimes: number[] = []

    const makeTask = () => async () => {
      dispatchTimes.push(Date.now())
    }

    const p1 = queue.enqueue('s', makeTask())
    const p2 = queue.enqueue('s', makeTask())
    const p3 = queue.enqueue('s', makeTask())

    // Run the first two tasks (dispatched immediately at t=0)
    await vi.runAllTimersAsync()

    // Advance past the 60-second sliding window so the rate limit resets
    vi.advanceTimersByTime(61_000)
    await vi.runAllTimersAsync()

    await Promise.all([p1, p2, p3])

    // First two dispatched immediately; third dispatched after the window rolled
    expect(dispatchTimes[0]).toBe(dispatchTimes[1])
    expect(dispatchTimes[2]).toBeGreaterThan(dispatchTimes[0])
  })
})

describe('ProviderQueue — affinity mode', () => {
  it('prioritises same-scope calls over different-scope calls', async () => {
    const queue = new ProviderQueue({ ...baseConfig, maxConcurrent: 1, affinityMode: true })

    const order: string[] = []

    // Block the queue with one in-flight task so we can inspect the pending order
    let releaseFirst!: () => void
    const firstDone = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })

    const first = queue.enqueue('A', async () => {
      order.push('A-first')
      await firstDone
    })

    // Enqueue competing tasks while first is running
    const second = queue.enqueue('B', async () => {
      order.push('B-second')
    })
    const third = queue.enqueue('A', async () => {
      order.push('A-third')
    })

    // Release the first task; A-third should be next because activeScope is 'A'
    releaseFirst()
    await Promise.all([first, second, third])

    // A-third must come before B-second
    const aThirdIdx = order.indexOf('A-third')
    const bSecondIdx = order.indexOf('B-second')
    expect(aThirdIdx).toBeLessThan(bSecondIdx)
  })
})

describe('ProviderQueue — warmup', () => {
  it('calls warmupFn exactly once before the first dispatch', async () => {
    const warmupFn = vi.fn().mockResolvedValue(undefined)
    const queue = new ProviderQueue({ ...baseConfig, warmup: true }, warmupFn)

    await queue.enqueue('s', async () => 'a')
    await queue.enqueue('s', async () => 'b')

    expect(warmupFn).toHaveBeenCalledTimes(1)
  })

  it('calls warmupFn before the payload function runs', async () => {
    const callOrder: string[] = []
    const warmupFn = vi.fn().mockImplementation(async () => {
      callOrder.push('warmup')
    })
    const queue = new ProviderQueue({ ...baseConfig, warmup: true }, warmupFn)

    await queue.enqueue('s', async () => {
      callOrder.push('fn')
    })

    expect(callOrder).toEqual(['warmup', 'fn'])
  })

  it('skips warmupFn when warmup is false', async () => {
    const warmupFn = vi.fn().mockResolvedValue(undefined)
    const queue = new ProviderQueue({ ...baseConfig, warmup: false }, warmupFn)

    await queue.enqueue('s', async () => 'x')

    expect(warmupFn).not.toHaveBeenCalled()
  })
})
