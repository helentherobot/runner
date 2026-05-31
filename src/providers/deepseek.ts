import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { Provider } from './types.js'

export class DeepSeekProvider implements Provider {
  readonly #client: ReturnType<typeof createOpenAI>

  constructor(apiKey: string, deps?: { client?: ReturnType<typeof createOpenAI> }) {
    this.#client =
      deps?.client ??
      createOpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com',
      })
  }

  model(key: string): LanguageModel {
    return this.#client(key)
  }
}
