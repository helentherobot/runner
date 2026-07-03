export class ProviderQueue {
  #config
  #warmupFn
  #warmedUp = false
  #inFlight = 0
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  #pending = []
  #activeScope = null
  // Sliding window: timestamps (ms) of dispatched requests in the last 60s
  #requestTimestamps = []
  constructor(config, warmupFn) {
    this.#config = config
    this.#warmupFn = warmupFn
  }
  enqueue(scope, fn) {
    return new Promise((resolve, reject) => {
      this.#pending.push({ scope, fn, resolve, reject })
      this.#drain()
    })
  }
  #drain() {
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
  #selectNext() {
    if (this.#config.affinityMode && this.#activeScope !== null) {
      const sameScope = this.#pending.findIndex((e) => e.scope === this.#activeScope)
      if (sameScope !== -1) {
        return this.#pending.splice(sameScope, 1)[0]
      }
    }
    return this.#pending.shift()
  }
  async #dispatch(entry) {
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
