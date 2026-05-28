import type { LanguageModel } from 'ai'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import type { Provider } from './types.js'

export class GoogleProvider implements Provider {
  readonly #client: ReturnType<typeof createGoogleGenerativeAI>

  constructor(apiKey: string, deps?: { client?: ReturnType<typeof createGoogleGenerativeAI> }) {
    this.#client = deps?.client ?? createGoogleGenerativeAI({ apiKey })
  }

  model(key: string): LanguageModel {
    return this.#client(key)
  }
}
