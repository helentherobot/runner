import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

describe.skipIf(!process.env.OPENAI_API_KEY)('OpenAI smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    const runner = new Runner({
      profiles: {
        openai: {
          provider: 'openai',
          model: 'gpt-4o-mini',
          contextWindowTokens: 128_000,
          requestTimeoutMs: 30_000,
          queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
        },
      },
      secrets: { openAi: process.env.OPENAI_API_KEY },
    })

    const r = recipe({ profile: 'openai', prompt: () => 'Say hello', maxOutputTokens: 16 })
    const result = await runner.run(r, [])

    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  })
})
