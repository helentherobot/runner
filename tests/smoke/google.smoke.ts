import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

describe.skipIf(!process.env.GOOGLE_API_KEY)('Google smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    const runner = new Runner({
      profiles: {
        google: {
          provider: 'google',
          model: 'gemini-2.5-flash',
          contextWindowTokens: 128_000,
          requestTimeoutMs: 30_000,
          queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
        },
      },
      secrets: { google: process.env.GOOGLE_API_KEY },
    })

    const r = recipe({ profile: 'google', prompt: () => 'Say hello', maxOutputTokens: 64 })
    const result = await runner.run(r, [])

    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThanOrEqual(0)
  })
})
