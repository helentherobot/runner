import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SessionOptions } from '../../src/session/types.js'
import type { RunnerConfig } from '../../src/types.js'

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { generateText } from 'ai'
import { Runner } from '../../src/runner.js'
import { recipe } from '../../src/recipes/recipe.js'
import { send } from '../../src/session/send.js'

const config: RunnerConfig = {
  profiles: {
    flash: {
      provider: 'google',
      model: 'gemini-2.0-flash',
      contextWindowTokens: 1_000_000,
      requestTimeoutMs: 30_000,
      queue: {
        maxConcurrent: 5,
        requestsPerMinute: 60,
        affinityMode: false,
        warmup: false,
      },
      costs: {
        inputPer1M: 0.1,
        outputPer1M: 0.4,
      },
    },
    opus: {
      provider: 'anthropic',
      model: 'claude-opus-4-5',
      contextWindowTokens: 200_000,
      requestTimeoutMs: 60_000,
      queue: {
        maxConcurrent: 2,
        requestsPerMinute: 30,
        affinityMode: false,
        warmup: false,
      },
    },
  },
  secrets: {
    google: 'test-google-key',
    anthropic: 'test-anthropic-key',
  },
}

function mockGenerateText(text: string, inputTokens = 10, outputTokens = 5) {
  vi.mocked(generateText).mockResolvedValue({
    text,
    usage: {
      inputTokens: inputTokens,
      outputTokens: outputTokens,
      cachedInputTokens: inputTokens + outputTokens,
    },
  } as unknown as Awaited<ReturnType<typeof generateText>>)
}

beforeEach(() => {
  vi.clearAllMocks()
})

describe('Runner integration', () => {
  it('runner.run(recipe) returns { text, usage }', async () => {
    mockGenerateText('Hello, world!', 8, 4)

    const runner = new Runner(config)
    const greet = recipe<[string]>({
      profile: 'flash',
      prompt: (name) => `Say hello to ${name}`,
    })

    const result = await runner.run(greet, ['hello'])

    expect(result.text).toBe('Hello, world!')
    expect(result.usage.inputTokens).toBe(8)
    expect(result.usage.outputTokens).toBe(4)
  })

  it('send() first turn returns { messages, usage } with 2 messages', async () => {
    mockGenerateText('First response')

    const runner = new Runner(config)
    const options: SessionOptions = { profile: 'flash', systemPrompt: 'You are helpful.' }

    const result = await send(runner, options, [], 'first message')

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({ role: 'user', content: 'first message' })
    expect(result.messages[1]).toEqual({ role: 'assistant', content: 'First response' })
    expect(result.usage.inputTokens).toBe(10)
  })

  it('send() second turn grows messages to 4 entries', async () => {
    mockGenerateText('First response')

    const runner = new Runner(config)
    const options: SessionOptions = { profile: 'flash', systemPrompt: 'You are helpful.' }

    const first = await send(runner, options, [], 'first message')

    mockGenerateText('Second response')
    const second = await send(runner, options, first.messages, 'second message')

    expect(second.messages).toHaveLength(4)
    expect(second.messages[2]).toEqual({ role: 'user', content: 'second message' })
    expect(second.messages[3]).toEqual({ role: 'assistant', content: 'Second response' })
  })

  it('send() throws when profile is unknown', async () => {
    const runner = new Runner(config)
    const options: SessionOptions = { profile: 'nonexistent' }

    await expect(send(runner, options, [], 'hello')).rejects.toThrow('Unknown profile: nonexistent')
  })

  it('queue is shared across calls to the same profile', async () => {
    mockGenerateText('response')

    const runner = new Runner(config)
    const options: SessionOptions = { profile: 'flash' }

    const first = await send(runner, options, [], 'first')

    mockGenerateText('response 2')
    await send(runner, options, first.messages, 'second')

    expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2)

    const firstQueueGetCall = vi.mocked(generateText).mock.calls[0]
    const secondQueueGetCall = vi.mocked(generateText).mock.calls[1]

    expect(firstQueueGetCall).toBeDefined()
    expect(secondQueueGetCall).toBeDefined()
  })
})
