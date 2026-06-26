import { generateText } from 'ai'
import type { RunnerConfig, ResolvedSecrets, ModelProfile } from '../types.js'
import type { Provider } from './types.js'
import { ProviderQueue } from './queue.js'
import { OpenRouterProvider } from './open-router.js'
import { GoogleProvider } from './google.js'
import { OpenAIProvider } from './openai.js'
import { AnthropicProvider } from './anthropic.js'
import { OllamaProvider } from './ollama.js'
import { DeepSeekProvider } from './deepseek.js'
import { LmStudioProvider } from './lm-studio.js'
import { AnthropicAgentProvider } from './anthropic-agent.js'

export class ProviderRegistry {
  readonly #config: RunnerConfig
  readonly #providers = new Map<string, Provider>()
  readonly #queues = new Map<string, ProviderQueue>()

  constructor(config: RunnerConfig) {
    this.#config = config
  }

  getProvider(key: string, secrets: ResolvedSecrets): Provider {
    if (this.#providers.has(key)) {
      return this.#providers.get(key)!
    }

    const provider = this.#createProvider(key, secrets)
    this.#providers.set(key, provider)
    return provider
  }

  #createProvider(key: string, secrets: ResolvedSecrets): Provider {
    switch (key) {
      case 'open-router':
        return new OpenRouterProvider(secrets.openRouter ?? '')
      case 'google':
        return new GoogleProvider(secrets.google ?? '')
      case 'openai':
        return new OpenAIProvider(secrets.openAi ?? '')
      case 'anthropic':
        return new AnthropicProvider(secrets.anthropic ?? '')
      case 'ollama':
        return new OllamaProvider()
      case 'deepseek':
        return new DeepSeekProvider(secrets.deepSeek ?? '')
      case 'lm-studio':
        return new LmStudioProvider(secrets.lmStudioBaseUrl)
      case 'anthropic-agent':
        return new AnthropicAgentProvider()
      default:
        throw new Error(`Unknown provider key: ${key}`)
    }
  }

  getQueue(profileKey: string, profile: ModelProfile): ProviderQueue {
    if (this.#queues.has(profileKey)) {
      return this.#queues.get(profileKey)!
    }

    let warmupFn: (() => Promise<void>) | undefined

    if (profile.queue.warmup) {
      const secrets = this.#config.secrets ?? {}
      const provider = this.getProvider(profile.provider, secrets)
      const model = provider.model(profile.model)

      warmupFn = async () => {
        await generateText({ model, prompt: 'hi', maxOutputTokens: 1 })
      }
    }

    const queue = new ProviderQueue(profile.queue, warmupFn)
    this.#queues.set(profileKey, queue)
    return queue
  }
}
