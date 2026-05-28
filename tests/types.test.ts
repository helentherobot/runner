import { describe, it, expectTypeOf } from 'vitest'
import type { RunnerConfig, ModelProfile, QueueConfig } from '@/types.js'

describe('QueueConfig', () => {
  it('accepts a valid shape', () => {
    const config = {
      maxConcurrent: 2,
      requestsPerMinute: 60,
      affinityMode: false,
      warmup: true,
    } satisfies QueueConfig

    expectTypeOf(config).toMatchTypeOf<QueueConfig>()
  })
})

describe('ModelProfile', () => {
  it('accepts a valid shape without optional fields', () => {
    const profile = {
      provider: 'openai',
      model: 'gpt-4o',
      contextWindowTokens: 128000,
      requestTimeoutMs: 30000,
      queue: {
        maxConcurrent: 2,
        requestsPerMinute: 60,
        affinityMode: false,
        warmup: false,
      },
    } satisfies ModelProfile

    expectTypeOf(profile).toMatchTypeOf<ModelProfile>()
  })

  it('accepts a valid shape with optional costs', () => {
    const profile = {
      provider: 'openai',
      model: 'gpt-4o',
      contextWindowTokens: 128000,
      requestTimeoutMs: 30000,
      queue: {
        maxConcurrent: 2,
        requestsPerMinute: 60,
        affinityMode: false,
        warmup: false,
      },
      costs: {
        inputPer1M: 2.5,
        outputPer1M: 10.0,
      },
    } satisfies ModelProfile

    expectTypeOf(profile).toMatchTypeOf<ModelProfile>()
  })

  it('accepts a valid shape with optional providerOptions', () => {
    const profile = {
      provider: 'open-router',
      model: 'anthropic/claude-3.5-sonnet',
      contextWindowTokens: 200000,
      requestTimeoutMs: 60000,
      queue: {
        maxConcurrent: 1,
        requestsPerMinute: 20,
        affinityMode: true,
        warmup: true,
      },
      providerOptions: { transforms: ['middle-out'] },
    } satisfies ModelProfile

    expectTypeOf(profile).toMatchTypeOf<ModelProfile>()
  })
})

describe('RunnerConfig', () => {
  it('accepts a valid config with no secrets', () => {
    const config = {
      profiles: {
        fast: {
          provider: 'google',
          model: 'gemini-2.0-flash',
          contextWindowTokens: 1048576,
          requestTimeoutMs: 30000,
          queue: {
            maxConcurrent: 5,
            requestsPerMinute: 60,
            affinityMode: false,
            warmup: false,
          },
        },
      },
    } satisfies RunnerConfig

    expectTypeOf(config).toMatchTypeOf<RunnerConfig>()
  })

  it('accepts a valid config with secrets', () => {
    const config = {
      profiles: {
        fast: {
          provider: 'google',
          model: 'gemini-2.0-flash',
          contextWindowTokens: 1048576,
          requestTimeoutMs: 30000,
          queue: {
            maxConcurrent: 5,
            requestsPerMinute: 60,
            affinityMode: false,
            warmup: false,
          },
        },
      },
      secrets: {
        google: 'test-api-key',
      },
    } satisfies RunnerConfig

    expectTypeOf(config).toMatchTypeOf<RunnerConfig>()
  })

  it('rejects a profile with a missing required field', () => {
    const bad = {
      provider: 'openai',
      contextWindowTokens: 128000,
      requestTimeoutMs: 30000,
      queue: {
        maxConcurrent: 2,
        requestsPerMinute: 60,
        affinityMode: false as const,
        warmup: false as const,
      },
    }
    // @ts-expect-error — missing required 'model' field
    const profile: ModelProfile = bad
    void profile
  })

  it('rejects secrets with unknown keys', () => {
    const badSecrets = { unknownProvider: 'some-key' }
    // @ts-expect-error — 'unknownProvider' is not a valid secrets key
    const config: RunnerConfig = { profiles: {}, secrets: badSecrets }
    void config
  })
})
