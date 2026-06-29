import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

// Manual test steps:
// 1. Start LM Studio on play, load google/gemma-4-12b-qat, start the server
// 2. Ensure ~/.claude/.credentials.json exists with a valid claudeAiOauth.accessToken
// 3. Run: LM_STUDIO_BASE_URL=http://100.106.138.70:1234/v1 npm run test:smoke -- availability

const sharedProfiles = {
  'lm-studio-gemma': {
    provider: 'lm-studio' as const,
    model: 'google/gemma-4-12b-qat',
    contextWindowTokens: 8_000,
    requestTimeoutMs: 60_000,
    providerOptions: {
      openai: { thinking: { type: 'enabled', budget_tokens: 512 } },
    },
    queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
  },
  'agent-haiku': {
    provider: 'anthropic-agent' as const,
    model: 'claude-haiku-4-5',
    contextWindowTokens: 200_000,
    requestTimeoutMs: 30_000,
    queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
  },
}

describe.skipIf(!process.env.LM_STUDIO_BASE_URL)('Availability smoke tests', () => {
  it(
    'uses gemma when lm-studio is available (primary succeeds)',
    { timeout: 90_000 },
    async () => {
      const runner = new Runner({
        profiles: {
          ...sharedProfiles,
          primary: { kind: 'composite', candidates: ['lm-studio-gemma', 'agent-haiku'] },
        },
        secrets: { lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL },
      })

      const r = recipe({ profile: 'primary', prompt: () => 'Say hello.', maxOutputTokens: 100 })
      const result = await runner.run(r, [])

      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.usage.inputTokens).toBeGreaterThan(0)
    },
  )

  it(
    'falls back to haiku when lm-studio reports unavailable',
    { timeout: 60_000 },
    async () => {
      const runner = new Runner({
        profiles: {
          ...sharedProfiles,
          'lm-studio-gemma': {
            ...sharedProfiles['lm-studio-gemma'],
            isAvailable: async () => false,
          },
          primary: { kind: 'composite', candidates: ['lm-studio-gemma', 'agent-haiku'] },
        },
        secrets: { lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL },
      })

      const r = recipe({ profile: 'primary', prompt: () => 'Say hello.', maxOutputTokens: 16 })
      const result = await runner.run(r, [])

      expect(typeof result.text).toBe('string')
      expect(result.text.length).toBeGreaterThan(0)
      expect(result.usage.inputTokens).toBeGreaterThan(0)
    },
  )
})
