import type { LanguageModel } from 'ai'
import { createOpenRouter } from '@openrouter/ai-sdk-provider'
import type { Provider } from './types.js'

export class OpenRouterProvider implements Provider {
  readonly #client: ReturnType<typeof createOpenRouter>

  constructor(apiKey: string, deps?: { client?: ReturnType<typeof createOpenRouter> }) {
    this.#client = deps?.client ?? createOpenRouter({ apiKey })
  }

  model(key: string): LanguageModel {
    return this.#client(key)
  }
}
