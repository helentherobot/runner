import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import type { LanguageModel } from 'ai'
import { createAnthropic } from '@ai-sdk/anthropic'
import type { Provider } from './types.js'

export class AnthropicAgentProvider implements Provider {
  readonly #client: ReturnType<typeof createAnthropic>

  constructor(credentialsPath?: string) {
    const path = credentialsPath ?? resolve(homedir(), '.claude', '.credentials.json')

    let raw: string
    try {
      raw = readFileSync(path, 'utf-8')
    } catch {
      throw new Error(`Credentials file not found: ${path}`)
    }

    const data = JSON.parse(raw)
    const token: string | undefined = data?.claudeAiOauth?.accessToken

    if (!token) {
      throw new Error(`No OAuth access token found at claudeAiOauth.accessToken in ${path}`)
    }

    this.#client = createAnthropic({
      authToken: token,
    })
  }

  model(key: string): LanguageModel {
    return this.#client(key)
  }
}
