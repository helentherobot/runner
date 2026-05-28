import type { LanguageModel } from 'ai'
import { createOllama } from 'ollama-ai-provider'
import type { Provider } from './provider.js'

export class OllamaProvider implements Provider {
  readonly #client: ReturnType<typeof createOllama>

  constructor(
    baseURL = 'http://localhost:11434',
    deps?: { client?: ReturnType<typeof createOllama> },
  ) {
    this.#client = deps?.client ?? createOllama({ baseURL })
  }

  model(key: string): LanguageModel {
    return this.#client(key) as unknown as LanguageModel
  }
}
