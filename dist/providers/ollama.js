import { createOllama } from 'ollama-ai-provider'
export class OllamaProvider {
  #client
  constructor(baseURL = 'http://localhost:11434', deps) {
    this.#client = deps?.client ?? createOllama({ baseURL })
  }
  model(key) {
    return this.#client(key)
  }
}
