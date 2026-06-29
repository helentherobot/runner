import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

// Manual test steps:
// 1. Start LM Studio on play, load google/gemma-4-12b-qat, start the server
// 2. Run: LM_STUDIO_BASE_URL=http://100.106.138.70:1234/v1 npm run test:smoke -- availability

const gemmaProfile = {
  provider: 'lm-studio' as const,
  model: 'google/gemma-4-12b-qat',
  contextWindowTokens: 8_000,
  requestTimeoutMs: 60_000,
  providerOptions: {
    openai: { thinking: { type: 'enabled', budget_tokens: 512 } },
  },
  queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
}

describe.skipIf(!process.env.LM_STUDIO_BASE_URL)('Availability smoke tests', () => {
  it('uses gemma when lm-studio is available', { timeout: 90_000 }, async () => {
    const runner = new Runner({
      profiles: {
        'lm-studio-gemma': gemmaProfile,
        primary: { kind: 'composite', candidates: ['lm-studio-gemma'] },
      },
      secrets: { lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL },
    })

    const r = recipe({ profile: 'primary', prompt: () => 'Say hello.', maxOutputTokens: 100 })
    const result = await runner.run(r, [])

    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  })

  it(
    'throws ProviderUnavailableError when lm-studio reports unavailable',
    { timeout: 10_000 },
    async () => {
      const { ProviderUnavailableError } = await import('../../src/index.js')
      const runner = new Runner({
        profiles: {
          'lm-studio-gemma': { ...gemmaProfile, isAvailable: async () => false },
          primary: { kind: 'composite', candidates: ['lm-studio-gemma'] },
        },
        secrets: { lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL },
      })

      const r = recipe({ profile: 'primary', prompt: () => 'Say hello.', maxOutputTokens: 16 })
      await expect(runner.run(r, [])).rejects.toThrow(ProviderUnavailableError)
    },
  )
})
