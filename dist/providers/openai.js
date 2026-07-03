import { createOpenAI } from '@ai-sdk/openai'
export class OpenAIProvider {
  #client
  constructor(apiKey, deps) {
    this.#client = deps?.client ?? createOpenAI({ apiKey })
  }
  model(key) {
    return this.#client(key)
  }
}
