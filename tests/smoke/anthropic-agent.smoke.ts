import { describe, it, expect } from 'vitest'
import { Runner, recipe } from '../../src/index.js'

// Manual test steps:
// 1. Ensure ~/.claude/.credentials.json exists with a valid claudeAiOauth.accessToken
// 2. Run: npm run test:smoke -- anthropic-agent

const hasCredentials = (() => {
  try {
    const { readFileSync } = require('node:fs')
    const { resolve } = require('node:path')
    const { homedir } = require('node:os')
    const data = JSON.parse(
      readFileSync(resolve(homedir(), '.claude', '.credentials.json'), 'utf-8'),
    )
    return !!data?.claudeAiOauth?.accessToken
  } catch {
    return false
  }
})()

describe.skipIf(!hasCredentials)('Anthropic Agent SDK smoke test', () => {
  it('makes a real inference request via OAuth credentials', { timeout: 30_000 }, async () => {
    const runner = new Runner({
      profiles: {
        haiku: {
          provider: 'anthropic-agent',
          model: 'claude-haiku-4-5',
          contextWindowTokens: 200_000,
          requestTimeoutMs: 30_000,
          queue: { maxConcurrent: 1, requestsPerMinute: 10, affinityMode: false, warmup: false },
        },
      },
      secrets: {},
    })

    const r = recipe({
      profile: 'haiku',
      prompt: () => 'Say hello in one sentence.',
      maxOutputTokens: 32,
    })
    const result = await runner.run(r, [])

    expect(typeof result.text).toBe('string')
    expect(result.text.length).toBeGreaterThan(0)
    expect(result.usage.inputTokens).toBeGreaterThan(0)
  })
})
