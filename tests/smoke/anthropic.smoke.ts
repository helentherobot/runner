import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

describe('Anthropic smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    const runner = new Runner({
      profiles: {
        anthropic: {
          provider: 'anthropic',
          model: 'claude-haiku-4-5',
          contextWindowTokens: 200_000,
          requestTimeoutMs: 30_000,
          queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
        },
      },
      secrets: { anthropic: process.env.ANTHROPIC_API_KEY },
    })

    const r = recipe({ profile: 'anthropic', prompt: () => 'Say hello', maxOutputTokens: 16 })
    const result = await runner.run(r, [])

    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  })
})
