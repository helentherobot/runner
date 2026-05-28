import { describe, it, expect, vi, beforeEach } from 'vitest'
import { ProviderRegistry } from '../../src/providers/registry.js'
import type { RunnerConfig, ResolvedSecrets, ModelProfile } from '../../src/types.js'

vi.mock('../../src/providers/open-router.js', () => ({
  OpenRouterProvider: vi.fn(function (this: { _apiKey: string; model: unknown }, apiKey: string) {
    this._apiKey = apiKey
    this.model = vi.fn().mockReturnValue({})
  }),
}))

vi.mock('../../src/providers/google.js', () => ({
  GoogleProvider: vi.fn(function (this: { _apiKey: string; model: unknown }, apiKey: string) {
    this._apiKey = apiKey
    this.model = vi.fn().mockReturnValue({})
  }),
}))

vi.mock('../../src/providers/openai.js', () => ({
  OpenAIProvider: vi.fn(function (this: { _apiKey: string; model: unknown }, apiKey: string) {
    this._apiKey = apiKey
    this.model = vi.fn().mockReturnValue({})
  }),
}))

vi.mock('../../src/providers/anthropic.js', () => ({
  AnthropicProvider: vi.fn(function (this: { _apiKey: string; model: unknown }, apiKey: string) {
    this._apiKey = apiKey
    this.model = vi.fn().mockReturnValue({})
  }),
}))

vi.mock('../../src/providers/ollama.js', () => ({
  OllamaProvider: vi.fn(function (this: Record<string, unknown>) {
    this.model = vi.fn().mockReturnValue({})
  }),
}))

vi.mock('ai', () => ({
  generateText: vi.fn().mockResolvedValue({}),
}))

import { OpenRouterProvider } from '../../src/providers/open-router.js'
import { GoogleProvider } from '../../src/providers/google.js'
import { OpenAIProvider } from '../../src/providers/openai.js'
import { AnthropicProvider } from '../../src/providers/anthropic.js'
import { OllamaProvider } from '../../src/providers/ollama.js'

const baseProfile: ModelProfile = {
  provider: 'open-router',
  model: 'openai/gpt-4o',
  contextWindowTokens: 128_000,
  requestTimeoutMs: 30_000,
  queue: {
    maxConcurrent: 5,
    requestsPerMinute: 60,
    affinityMode: false,
    warmup: false,
  },
}

const baseConfig: RunnerConfig = {
  profiles: {
    main: baseProfile,
  },
  secrets: {
    openRouter: 'or-key',
    google: 'g-key',
    openAi: 'oai-key',
    anthropic: 'ant-key',
  },
}

const secrets: ResolvedSecrets = baseConfig.secrets!

describe('ProviderRegistry — singleton behavior', () => {
  let registry: ProviderRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    registry = new ProviderRegistry(baseConfig)
  })

  it('returns the same Provider instance on repeated getProvider() calls', () => {
    const first = registry.getProvider('open-router', secrets)
    const second = registry.getProvider('open-router', secrets)
    expect(first).toBe(second)
  })

  it('returns the same ProviderQueue instance on repeated getQueue() calls', () => {
    const first = registry.getQueue('main', baseProfile)
    const second = registry.getQueue('main', baseProfile)
    expect(first).toBe(second)
  })

  it('throws for an unknown provider key', () => {
    expect(() => registry.getProvider('unknown-provider', secrets)).toThrow(
      'Unknown provider key: unknown-provider',
    )
  })
})

describe('ProviderRegistry — secrets wiring', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('passes openRouter secret to OpenRouterProvider', () => {
    const registry = new ProviderRegistry(baseConfig)
    registry.getProvider('open-router', secrets)
    expect(OpenRouterProvider).toHaveBeenCalledWith('or-key')
  })

  it('passes google secret to GoogleProvider', () => {
    const registry = new ProviderRegistry(baseConfig)
    registry.getProvider('google', secrets)
    expect(GoogleProvider).toHaveBeenCalledWith('g-key')
  })

  it('passes openAi secret to OpenAIProvider', () => {
    const registry = new ProviderRegistry(baseConfig)
    registry.getProvider('openai', secrets)
    expect(OpenAIProvider).toHaveBeenCalledWith('oai-key')
  })

  it('passes anthropic secret to AnthropicProvider', () => {
    const registry = new ProviderRegistry(baseConfig)
    registry.getProvider('anthropic', secrets)
    expect(AnthropicProvider).toHaveBeenCalledWith('ant-key')
  })

  it('constructs OllamaProvider with no API key', () => {
    const registry = new ProviderRegistry(baseConfig)
    registry.getProvider('ollama', secrets)
    expect(OllamaProvider).toHaveBeenCalledWith()
  })
})
