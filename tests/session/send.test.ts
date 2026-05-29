import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest'
import { zodSchema } from 'ai'
import type { ModelMessage } from 'ai'
import type { RunnerInstance } from '../../src/recipes/run-recipe.js'
import type { ModelProfile } from '../../src/types.js'
import type { DiscoverableTool, SessionOptions } from '../../src/session/types.js'
import { RequestTimeoutError, RequestCancelledError } from '../../src/errors.js'
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

  it('passes abortSignal to generateText when caller provides one', async () => {
    mockGenerateText('response')
    const controller = new AbortController()
    const options: SessionOptions = { profile: 'main', abortSignal: controller.signal }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.abortSignal).toBeDefined()
  })

  it('passes abortSignal to generateText even when no caller signal supplied', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.abortSignal).toBeDefined()
  })

  it('passes maxRetries: 0 to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.maxRetries).toBe(0)
  })

  it('does not pass maxOutputTokens to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall).not.toHaveProperty('maxOutputTokens')
  })

  it('passes onStepFinish to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, [], 'Hello')

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.onStepFinish).toBeTypeOf('function')
  })

  describe('prepareStep', () => {
    it('is forwarded to generateText when provided', async () => {
      mockGenerateText('response')
      const prepareStep = vi.fn()
      const options: SessionOptions = { profile: 'main', prepareStep }

      await send(makeRunner(), options, [], 'Hello')

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.prepareStep).toBe(prepareStep)
    })

    it('is not passed when absent', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, [], 'Hello')

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.prepareStep).toBeUndefined()
    })
  })

  describe('stopWhen', () => {
    it('is forwarded to generateText when provided', async () => {
      mockGenerateText('response')
      const stopWhen = vi.fn().mockReturnValue(false)
      const options: SessionOptions = { profile: 'main', stopWhen }

      await send(makeRunner(), options, [], 'Hello')

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBe(stopWhen)
    })

    it('is not passed when absent', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, [], 'Hello')

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBeUndefined()
    })
  })

  describe('providerOptions', () => {
    it('is forwarded to generateText from the model profile', async () => {
      const providerOptions = { anthropic: { cacheControl: true } }
      const profile: ModelProfile = { ...baseProfile, providerOptions }
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(profile), options, [], 'Hello')

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.providerOptions).toBe(providerOptions)
    })

    it('is undefined when not set on the profile', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, [], 'Hello')

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.providerOptions).toBeUndefined()
    })
  })

  describe('onStepFinish composition', () => {
    it('calls the external onStepFinish callback with the step result', async () => {
      const externalCallback = vi.fn()
      const fakeStep = { text: 'step', toolCalls: [], usage: {} }

      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockImplementation(
        async (opts: Parameters<typeof generateText>[0]) => {
          const onStepFinish = (opts as { onStepFinish?: (step: unknown) => Promise<void> })
            .onStepFinish
          await onStepFinish?.(fakeStep)
          return {
            text: 'response',
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = { profile: 'main', onStepFinish: externalCallback }
      await send(makeRunner(), options, [], 'Hello')

      expect(externalCallback).toHaveBeenCalledTimes(1)
      expect(externalCallback).toHaveBeenCalledWith(fakeStep)
    })

    it('does not throw when no external onStepFinish is provided', async () => {
      const fakeStep = { text: 'step', toolCalls: [], usage: {} }

      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockImplementation(
        async (opts: Parameters<typeof generateText>[0]) => {
          const onStepFinish = (opts as { onStepFinish?: (step: unknown) => Promise<void> })
            .onStepFinish
          await onStepFinish?.(fakeStep)
          return {
            text: 'response',
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = { profile: 'main' }
      await expect(send(makeRunner(), options, [], 'Hello')).resolves.toBeDefined()
    })
  })

  describe('timeout & retry', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    function mockGenerateTextWithTimeout() {
      vi.mocked(generateText).mockImplementation(
        (opts: Parameters<typeof generateText>[0]) =>
          new Promise((_resolve, reject) => {
            const signal = (opts as { abortSignal?: AbortSignal }).abortSignal
            if (signal?.aborted) {
              reject(new DOMException('AbortError', 'AbortError'))
              return
            }
            signal?.addEventListener('abort', () => {
              reject(new DOMException('AbortError', 'AbortError'))
            })
          }),
      )
    }

    it('retries up to maxRetries times on timeout', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 2, requestTimeoutMs: 100 }
      mockGenerateTextWithTimeout()

      const resultPromise = send(makeRunner(profile), { profile: 'main' }, [], 'Hello')
      const rejection = expect(resultPromise).rejects.toBeInstanceOf(RequestTimeoutError)

      // Each attempt: advance past timeout, then past sleep(1000) for retries
      for (let i = 0; i < 3; i++) {
        await vi.advanceTimersByTimeAsync(100) // trigger timeout
        if (i < 2) {
          await vi.advanceTimersByTimeAsync(1000) // sleep between retries
        }
      }

      await rejection
      // 3 calls: attempt 0, 1, 2 (maxRetries=2 means attempts 0..2)
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(3)
    })

    it('throws RequestTimeoutError after exhausting retries', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 1, requestTimeoutMs: 100 }
      mockGenerateTextWithTimeout()

      const resultPromise = send(makeRunner(profile), { profile: 'main' }, [], 'Hello')
      const rejection = expect(resultPromise).rejects.toBeInstanceOf(RequestTimeoutError)

      await vi.advanceTimersByTimeAsync(100)
      await vi.advanceTimersByTimeAsync(1000)
      await vi.advanceTimersByTimeAsync(100)

      await rejection
    })

    it('throws RequestCancelledError when caller aborts', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 3, requestTimeoutMs: 5000 }
      const callerController = new AbortController()

      vi.mocked(generateText).mockImplementation(
        (opts: Parameters<typeof generateText>[0]) =>
          new Promise((_resolve, reject) => {
            const signal = (opts as { abortSignal?: AbortSignal }).abortSignal
            signal?.addEventListener('abort', () => {
              reject(new DOMException('AbortError', 'AbortError'))
            })
          }),
      )

      const resultPromise = send(
        makeRunner(profile),
        { profile: 'main', abortSignal: callerController.signal },
        [],
        'Hello',
      )
      const rejection = expect(resultPromise).rejects.toBeInstanceOf(RequestCancelledError)

      callerController.abort()
      await vi.runAllTimersAsync()

      await rejection
    })

    it('returns correct messages after one timeout retry', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 2, requestTimeoutMs: 100 }

      let callCount = 0
      vi.mocked(generateText).mockImplementation(
        (opts: Parameters<typeof generateText>[0]) =>
          new Promise((resolve, reject) => {
            callCount++
            const signal = (opts as { abortSignal?: AbortSignal }).abortSignal
            if (callCount === 1) {
              signal?.addEventListener('abort', () => {
                reject(new DOMException('AbortError', 'AbortError'))
              })
            } else {
              resolve({
                text: 'success after retry',
                usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
              } as unknown as Awaited<ReturnType<typeof generateText>>)
            }
          }),
      )

      const promise = send(makeRunner(profile), { profile: 'main' }, [], 'Hello')

      await vi.advanceTimersByTimeAsync(100) // trigger first timeout
      await vi.advanceTimersByTimeAsync(1000) // sleep before retry

      const result = await promise

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(result.messages[1]).toEqual({ role: 'assistant', content: 'success after retry' })
    })
  })
})
