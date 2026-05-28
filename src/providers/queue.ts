import type { QueueConfig } from '../types.js'

interface QueueEntry<T> {
  scope: string
  fn: () => Promise<T>
  resolve: (value: T) => void
  reject: (reason: unknown) => void
}

export class ProviderQueue {
  readonly #config: QueueConfig
  readonly #warmupFn: (() => Promise<void>) | undefined
  #warmedUp = false
  #inFlight = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #pending: QueueEntry<any>[] = []
  #activeScope: string | null = null

  // Sliding window: timestamps (ms) of dispatched requests in the last 60s
  #requestTimestamps: number[] = []

  constructor(config: QueueConfig, warmupFn?: () => Promise<void>) {
    this.#config = config
    this.#warmupFn = warmupFn
  }

  enqueue<T>(scope: string, fn: () => Promise<T>): Promise<T> {
    return new Promise<T>((resolve, reject) => {
      this.#pending.push({ scope, fn, resolve, reject })
      this.#drain()
    })
  }

  #drain(): void {
    if (this.#pending.length === 0) return
    if (this.#inFlight >= this.#config.maxConcurrent) return

    const now = Date.now()
    const windowStart = now - 60_000

    if (this.#config.requestsPerMinute > 0) {
      // Drop timestamps outside the sliding window
      this.#requestTimestamps = this.#requestTimestamps.filter((t) => t > windowStart)

      if (this.#requestTimestamps.length >= this.#config.requestsPerMinute) {
        // Schedule a retry once the oldest timestamp falls outside the window
        const oldestInWindow = this.#requestTimestamps[0]
        const retryAfter = oldestInWindow + 60_000 - now + 1
        setTimeout(() => this.#drain(), retryAfter)
        return
      }
    }

    const entry = this.#selectNext()
    if (!entry) return

    this.#inFlight++
    if (this.#config.requestsPerMinute > 0) {
      this.#requestTimestamps.push(Date.now())
    }
    this.#activeScope = entry.scope

    this.#dispatch(entry)
  }

  #selectNext<T>(): QueueEntry<T> | undefined {
    if (this.#config.affinityMode && this.#activeScope !== null) {
      const sameScope = this.#pending.findIndex((e) => e.scope === this.#activeScope)
      if (sameScope !== -1) {
        return this.#pending.splice(sameScope, 1)[0]
      }
    }
    return this.#pending.shift()
  }

  async #dispatch<T>(entry: QueueEntry<T>): Promise<void> {
    try {
      if (this.#config.warmup && !this.#warmedUp && this.#warmupFn) {
        this.#warmedUp = true
        await this.#warmupFn()
      }
      const result = await entry.fn()
      entry.resolve(result)
    } catch (err) {
      entry.reject(err)
    } finally {
      this.#inFlight--
      this.#drain()
    }
  }
}
