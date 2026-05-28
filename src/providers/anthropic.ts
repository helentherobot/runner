import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { Provider } from './provider.js'

export class AnthropicProvider implements Provider {
  readonly #client: ReturnType<typeof createAnthropic>

  constructor(apiKey: string, deps?: { client?: ReturnType<typeof createAnthropic> }) {
    this.#client = deps?.client ?? createAnthropic({ apiKey })
  }

  model(key: string): LanguageModel {
    return this.#client(key)
  }
}
