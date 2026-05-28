import { describe, it, expect, vi, beforeEach, expectTypeOf } from 'vitest'
import { zodSchema } from 'ai'
import type { ModelMessage } from 'ai'
import type { RunnerInstance } from '../../src/recipes/run-recipe.js'
import type { ModelProfile } from '../../src/types.js'
import type { DiscoverableTool, SessionOptions } from '../../src/session/types.js'
import { z } from 'zod'

const mockEnqueue = vi.fn()
const mockModel = {}
const mockGetProvider = vi.fn().mockReturnValue({ model: vi.fn().mockReturnValue(mockModel) })
const mockGetQueue = vi.fn().mockReturnValue({ enqueue: mockEnqueue })

vi.mock('ai', async (importOriginal) => {
  const actual = await importOriginal<typeof import('ai')>()
  return {
    ...actual,
    generateText: vi.fn(),
  }
})

import { generateText } from 'ai'
import { send } from '../../src/session/send.js'

const baseProfile: ModelProfile = {
  provider: 'open-router',
  model: 'openai/gpt-4o',
  contextWindowTokens: 128_000,
  requestTimeoutMs: 30_000,
  queue: {
    maxConcurrent: 5,
    requestsPerMinute: 60,
    affinityMode: false,
    warmup: false,
  },
  costs: {
    inputPer1M: 5,
    outputPer1M: 15,
  },
}

function makeRunner(profile: ModelProfile = baseProfile): RunnerInstance {
  return {
    config: {
      profiles: { main: profile },
      secrets: { openRouter: 'key' },
    },
    registry: {
      getProvider: mockGetProvider,
      getQueue: mockGetQueue,
    } as unknown as RunnerInstance['registry'],
  }
}

function makeTool(name: string, keywords?: () => string[]): DiscoverableTool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: zodSchema(z.object({})),
    ...(keywords ? { keywords } : {}),
  }
}

function mockGenerateText(text: string) {
  mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
  vi.mocked(generateText).mockResolvedValue({
    text,
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
  } as unknown as Awaited<ReturnType<typeof generateText>>)
}

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProvider.mockReturnValue({ model: vi.fn().mockReturnValue(mockModel) })
  mockGetQueue.mockReturnValue({ enqueue: mockEnqueue })
})

describe('SessionOptions', () => {
  it('accepts abortSignal', () => {
    const options: SessionOptions = {
      profile: 'main',
      abortSignal: new AbortController().signal,
    }

    expectTypeOf(options).toExtend<SessionOptions>()
  })
})

describe('send()', () => {
  it('single turn: returned messages has 2 entries (user + assistant)', async () => {
    mockGenerateText('Hello back')
    const options: SessionOptions = { profile: 'main' }

    const result = await send(makeRunner(), options, [], 'Hello')

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' })
    expect(result.messages[1]).toEqual({ role: 'assistant', content: 'Hello back' })
  })

  it('multi-turn: calling send() twice grows messages to 4 entries', async () => {
    mockGenerateText('First response')
    const options: SessionOptions = { profile: 'main' }

    const first = await send(makeRunner(), options, [], 'First message')

    mockGenerateText('Second response')
    const second = await send(makeRunner(), options, first.messages, 'Second message')

    expect(second.messages).toHaveLength(4)
  })

  it('messages.at(-1) is the assistant response', async () => {
    mockGenerateText('I am the assistant')
    const options: SessionOptions = { profile: 'main' }

    const result = await send(makeRunner(), options, [], 'Hi')

    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'I am the assistant' })
  })

  it('tool discovery — absent keywords: tool always included', async () => {
    mockGenerateText('response')
    const tool = makeTool('always')
    const options: SessionOptions = { profile: 'main', tools: [tool] }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.tools).toBeDefined()
    expect(Object.keys(generateTextCall.tools!)).toContain('always')
  })

  it('tool discovery — keyword match: tool included when keyword present in messages', async () => {
    mockGenerateText('response')
    const tool = makeTool('search', () => ['search'])
    const options: SessionOptions = { profile: 'main', tools: [tool] }
    const messages: ModelMessage[] = [{ role: 'assistant', content: 'I can search for things' }]

    await send(makeRunner(), options, messages, 'Find something')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.tools).toBeDefined()
    expect(Object.keys(generateTextCall.tools!)).toContain('search')
  })

  it('tool discovery — keyword no-match: tool excluded when keyword absent', async () => {
    mockGenerateText('response')
    const tool = makeTool('search', () => ['search'])
    const options: SessionOptions = { profile: 'main', tools: [tool] }
    const messages: ModelMessage[] = [{ role: 'assistant', content: 'The weather is nice' }]

    await send(makeRunner(), options, messages, 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.tools).toBeUndefined()
  })

  it('passes system prompt to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main', systemPrompt: 'You are helpful.' }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.system).toBe('You are helpful.')
  })

  it('calls queue enqueue with the profile key', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, [], 'Hello')

    expect(mockEnqueue).toHaveBeenCalledWith('main', expect.any(Function))
  })

  it('throws when the profile key is not found in config', async () => {
    const options: SessionOptions = { profile: 'nonexistent' }

    await expect(send(makeRunner(), options, [], 'Hello')).rejects.toThrow(
      'Unknown profile: nonexistent',
    )
  })
})
