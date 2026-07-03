import { createOpenAI } from '@ai-sdk/openai'
const DEFAULT_BASE_URL = 'http://localhost:1234/v1'
export class LmStudioProvider {
  #client
  constructor(baseURL = DEFAULT_BASE_URL, deps) {
    this.#client =
      deps?.client ??
      createOpenAI({
        apiKey: 'lm-studio', // LM Studio ignores the API key; placeholder required by the SDK
        baseURL,
      })
  }
  model(key) {
    // LM Studio uses the /chat/completions endpoint; .chat() avoids the /responses route
    return this.#client.chat(key)
  }
}
