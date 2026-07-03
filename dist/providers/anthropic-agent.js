import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { homedir } from 'node:os'
import { createAnthropic } from '@ai-sdk/anthropic'
export class AnthropicAgentProvider {
  #client
  constructor(credentialsPath) {
    const path = credentialsPath ?? resolve(homedir(), '.claude', '.credentials.json')
    let raw
    try {
      raw = readFileSync(path, 'utf-8')
    } catch {
      throw new Error(`Credentials file not found: ${path}`)
    }
    const data = JSON.parse(raw)
    const token = data?.claudeAiOauth?.accessToken
    if (!token) {
      throw new Error(`No OAuth access token found at claudeAiOauth.accessToken in ${path}`)
    }
    this.#client = createAnthropic({
      authToken: token,
    })
  }
  model(key) {
    return this.#client(key)
  }
}
