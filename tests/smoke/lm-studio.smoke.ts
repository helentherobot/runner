import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

// Manual test steps:
// 1. Start LM Studio, load a model, and start the local server (default port 1234)
// 2. Run: LM_STUDIO_BASE_URL=http://localhost:1234/v1 npm run test:smoke -- lm-studio

describe.skip('LM Studio smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    const runner = new Runner({
      profiles: {
        'lm-studio': {
          provider: 'lm-studio',
          model: 'llama3.2-3b',
          contextWindowTokens: 8_000,
          requestTimeoutMs: 60_000,
          queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
        },
      },
      secrets: { lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL },
    })

    const r = recipe({ profile: 'lm-studio', prompt: () => 'Say hello.', maxOutputTokens: 16 })
    const result = await runner.run(r, [])

    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  })
})
