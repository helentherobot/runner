import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { Provider } from './types.js'

const DEFAULT_BASE_URL = 'http://localhost:1234/v1'

export class LmStudioProvider implements Provider {
  readonly #client: ReturnType<typeof createOpenAI>

  constructor(baseURL = DEFAULT_BASE_URL, deps?: { client?: ReturnType<typeof createOpenAI> }) {
    this.#client =
      deps?.client ??
      createOpenAI({
        apiKey: 'lm-studio', // LM Studio ignores the API key; placeholder required by the SDK
        baseURL,
      })
  }

  model(key: string): LanguageModel {
    // LM Studio uses the /chat/completions endpoint; .chat() avoids the /responses route
    return this.#client.chat(key)
  }
}
