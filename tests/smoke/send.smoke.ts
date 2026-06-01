import { describe, it, expect } from 'vitest'
import { zodSchema } from 'ai'
import { z } from 'zod'
import { Runner } from '../../src/index.js'
import { send } from '../../src/session/send.js'
import type { DiscoverableTool } from '../../src/session/types.js'

// Real tool-calling smoke test. Verifies that:
//   1. send() actually drives a multi-step tool-use loop with a real provider
//   2. result.messages contains the tool call and tool result entries (not just the final text)
//   3. A second send() call receives the full tool interaction history
//
// Run with: GOOGLE_API_KEY=... npm run test:smoke -- send

const addTool: DiscoverableTool = {
  name: 'add',
  description: 'Add two numbers together and return the result.',
  inputSchema: zodSchema(z.object({ a: z.number(), b: z.number() })),
  execute: async ({ a, b }: { a: number; b: number }) => ({ result: a + b }),
}

describe.skipIf(!process.env.GOOGLE_API_KEY)('send() tool calling smoke test (Google)', () => {
  function makeRunner() {
    return new Runner({
      profiles: {
        flash: {
          provider: 'google',
          model: 'gemini-2.5-flash',
          contextWindowTokens: 200_000,
          requestTimeoutMs: 120_000,
          maxSteps: 5,
          providerOptions: {
            google: { thinkingConfig: { thinkingBudget: 0 } },
          },
          queue: {
            maxConcurrent: 5,
            requestsPerMinute: 20,
            affinityMode: false,
            warmup: false,
          },
        },
      },
      secrets: { google: process.env.GOOGLE_API_KEY },
    })
  }

  it(
    'model calls the add tool and result.messages contains tool call + tool result entries',
    { timeout: 30_000 },
    async () => {
      const runner = makeRunner()

      const result = await send(
        runner,
        { profile: 'flash', tools: [addTool], progressiveToolDiscovery: false },
        ['Use the add tool to calculate 7 + 5. You must call the tool.'],
      )

      // Must have at least: user, assistant(tool-call), tool(result), assistant(final)
      expect(result.messages.length).toBeGreaterThanOrEqual(4)

      const toolCallEntry = result.messages.find(
        (m) =>
          m.role === 'assistant' &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === 'tool-call' && p.toolName === 'add'),
      )
      expect(toolCallEntry).toBeDefined()

      const toolResultEntry = result.messages.find(
        (m) =>
          m.role === 'tool' &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === 'tool-result' && p.toolName === 'add'),
      )
      expect(toolResultEntry).toBeDefined()

      // Final message must be assistant text
      const finalMsg = result.messages.at(-1)
      expect(finalMsg?.role).toBe('assistant')
    },
  )

  it(
    'second send() receives the full tool interaction history and model can reference it',
    { timeout: 60_000 },
    async () => {
      const runner = makeRunner()

      const first = await send(
        runner,
        { profile: 'flash', tools: [addTool], progressiveToolDiscovery: false },
        ['Use the add tool to calculate 3 + 4. You must call the tool.'],
      )

      // First turn must have the tool interaction chain
      expect(first.messages.length).toBeGreaterThanOrEqual(4)

      const toolResultEntry = first.messages.find(
        (m) =>
          m.role === 'tool' &&
          Array.isArray(m.content) &&
          m.content.some((p) => p.type === 'tool-result'),
      )
      expect(toolResultEntry).toBeDefined()

      // Second turn — pass the full history and ask about it
      const second = await send(
        runner,
        { profile: 'flash', tools: [addTool], progressiveToolDiscovery: false },
        [...first.messages, 'What number did the add tool return?'],
      )

      const finalMsg = second.messages.at(-1)
      expect(finalMsg?.role).toBe('assistant')

      const text =
        typeof finalMsg?.content === 'string'
          ? finalMsg.content
          : Array.isArray(finalMsg?.content)
            ? finalMsg.content
                .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                .map((p) => p.text)
                .join('')
            : ''

      // Model should mention 7 — the result of 3 + 4
      expect(text).toMatch(/7/)
    },
  )
})
