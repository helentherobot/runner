import { describe, it, expect, vi, beforeEach, afterEach, expectTypeOf } from 'vitest'
import { zodSchema } from 'ai'
import type { CoreMessage, ModelMessage } from 'ai'
import type { RunnerInstance } from '../../src/recipes/run-recipe.js'
import type { ModelProfile, AnyProfile } from '../../src/types.js'
import type { DiscoverableTool, SessionOptions } from '../../src/session/types.js'
import {
  RequestTimeoutError,
  RequestCancelledError,
  ProviderUnavailableError,
} from '../../src/errors.js'
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

function mockGenerateText(text: string, responseMessages?: ModelMessage[]) {
  mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
  vi.mocked(generateText).mockResolvedValue({
    text,
    usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
    response: {
      messages: responseMessages ?? [{ role: 'assistant', content: text }],
    },
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

    const result = await send(makeRunner(), options, ['Hello'])

    expect(result.messages).toHaveLength(2)
    expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' })
    expect(result.messages[1]).toEqual({ role: 'assistant', content: 'Hello back' })
  })

  it('multi-turn: calling send() twice grows messages to 4 entries', async () => {
    mockGenerateText('First response')
    const options: SessionOptions = { profile: 'main' }

    const first = await send(makeRunner(), options, ['First message'])

    mockGenerateText('Second response')
    const second = await send(makeRunner(), options, [...first.messages, 'Second message'])

    expect(second.messages).toHaveLength(4)
  })

  it('messages.at(-1) is the assistant response', async () => {
    mockGenerateText('I am the assistant')
    const options: SessionOptions = { profile: 'main' }

    const result = await send(makeRunner(), options, ['Hi'])

    expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'I am the assistant' })
  })

  it('tool discovery — absent keywords: tool always included', async () => {
    mockGenerateText('response')
    const tool = makeTool('always')
    const options: SessionOptions = { profile: 'main', tools: [tool] }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.tools).toBeDefined()
    expect(Object.keys(generateTextCall.tools!)).toContain('always')
  })

  it('tool discovery — keyword match: tool included when keyword present in messages', async () => {
    mockGenerateText('response')
    const tool = makeTool('search', () => ['search'])
    const options: SessionOptions = { profile: 'main', tools: [tool] }
    const messages: CoreMessage[] = [{ role: 'assistant', content: 'I can search for things' }]

    await send(makeRunner(), options, [...messages, 'Find something'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.tools).toBeDefined()
    expect(Object.keys(generateTextCall.tools!)).toContain('search')
  })

  it('tool discovery — keyword no-match: tool excluded when keyword absent', async () => {
    mockGenerateText('response')
    const tool = makeTool('search', () => ['search'])
    const options: SessionOptions = { profile: 'main', tools: [tool] }
    const messages: CoreMessage[] = [{ role: 'assistant', content: 'The weather is nice' }]

    await send(makeRunner(), options, [...messages, 'Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.tools).toBeUndefined()
  })

  it('passes system prompt to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main', systemPrompt: 'You are helpful.' }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.system).toBe('You are helpful.')
  })

  it('calls queue enqueue with the profile key', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, ['Hello'])

    expect(mockEnqueue).toHaveBeenCalledWith('main', expect.any(Function))
  })

  it('throws when the profile key is not found in config', async () => {
    const options: SessionOptions = { profile: 'nonexistent' }

    await expect(send(makeRunner(), options, ['Hello'])).rejects.toThrow(
      'Unknown profile: nonexistent',
    )
  })

  it('passes abortSignal to generateText when caller provides one', async () => {
    mockGenerateText('response')
    const controller = new AbortController()
    const options: SessionOptions = { profile: 'main', abortSignal: controller.signal }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.abortSignal).toBeDefined()
  })

  it('passes abortSignal to generateText even when no caller signal supplied', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.abortSignal).toBeDefined()
  })

  it('passes maxRetries: 0 to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.maxRetries).toBe(0)
  })

  it('does not pass maxOutputTokens to generateText when not configured', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall).not.toHaveProperty('maxOutputTokens')
  })

  it('passes onStepFinish to generateText', async () => {
    mockGenerateText('response')
    const options: SessionOptions = { profile: 'main' }

    await send(makeRunner(), options, ['Hello'])

    const generateTextCall = vi.mocked(generateText).mock.calls[0][0]
    expect(generateTextCall.onStepFinish).toBeTypeOf('function')
  })

  describe('prepareStep', () => {
    it('is forwarded to generateText when provided', async () => {
      mockGenerateText('response')
      const prepareStep = vi.fn().mockResolvedValue(undefined)
      const options: SessionOptions = { profile: 'main', prepareStep }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      // prepareStep is wrapped to normalise void returns; verify the wrapper delegates to the original
      expect(call.prepareStep).toBeTypeOf('function')
      const ctx = { messages: [], steps: [], model: {} as never, usage: {} as never }
      await call.prepareStep!(ctx as never)
      expect(prepareStep).toHaveBeenCalledWith(ctx)
    })

    it('is always passed to support per-step tool re-evaluation', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.prepareStep).toBeTypeOf('function')
    })
  })

  describe('stopWhen', () => {
    it('is forwarded to generateText when provided', async () => {
      mockGenerateText('response')
      const stopWhen = vi.fn().mockReturnValue(false)
      const options: SessionOptions = { profile: 'main', stopWhen }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBe(stopWhen)
    })

    it('is not passed when absent', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBeUndefined()
    })

    it('array form is forwarded as-is and is not overridden by maxSteps', async () => {
      // stopWhen can be an array of conditions — even an array wins over maxSteps
      // because arrays are truthy and ?? only fires on null/undefined
      mockGenerateText('response')
      const cond1 = vi.fn().mockReturnValue(Promise.resolve(false))
      const cond2 = vi.fn().mockReturnValue(Promise.resolve(false))
      const stopWhen = [cond1, cond2]
      const options: SessionOptions = { profile: 'main', stopWhen, maxSteps: 5 }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBe(stopWhen)
    })

    it('wins over profile-level maxSteps', async () => {
      // An explicit stopWhen beats maxSteps regardless of whether it comes from the profile
      const profile: ModelProfile = { ...baseProfile, maxSteps: 10 }
      mockGenerateText('response')
      const stopWhen = vi.fn().mockReturnValue(false)
      const options: SessionOptions = { profile: 'main', stopWhen }

      await send(makeRunner(profile), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBe(stopWhen)
    })
  })

  describe('providerOptions', () => {
    it('is forwarded to generateText from the model profile', async () => {
      const providerOptions = { anthropic: { cacheControl: true } }
      const profile: ModelProfile = { ...baseProfile, providerOptions }
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(profile), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.providerOptions).toBe(providerOptions)
    })

    it('is undefined when not set on the profile', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, ['Hello'])

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
            response: { messages: [{ role: 'assistant', content: 'response' }] },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = { profile: 'main', onStepFinish: externalCallback }
      await send(makeRunner(), options, ['Hello'])

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
            response: { messages: [{ role: 'assistant', content: 'response' }] },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = { profile: 'main' }
      await expect(send(makeRunner(), options, ['Hello'])).resolves.toBeDefined()
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

      const resultPromise = send(makeRunner(profile), { profile: 'main' }, ['Hello'])
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

      const resultPromise = send(makeRunner(profile), { profile: 'main' }, ['Hello'])
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
        ['Hello'],
      )
      const rejection = expect(resultPromise).rejects.toBeInstanceOf(RequestCancelledError)

      callerController.abort()
      await vi.runAllTimersAsync()

      await rejection
    })

    it('isRetryable returns false: non-timeout error is rethrown immediately, no retry', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 3, requestTimeoutMs: 30_000 }
      const nonTimeoutError = Object.assign(new Error('network failure'), { name: 'NetworkError' })

      vi.mocked(generateText).mockRejectedValue(nonTimeoutError)

      const isRetryable = vi.fn().mockReturnValue(false)
      const resultPromise = send(makeRunner(profile), { profile: 'main', isRetryable }, ['Hello'])

      await expect(resultPromise).rejects.toThrow('network failure')
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1)
      expect(isRetryable).toHaveBeenCalledWith(nonTimeoutError)
    })

    it('isRetryable returns true: non-timeout error is retried and onRetry fires', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 2, requestTimeoutMs: 30_000 }
      const nonTimeoutError = Object.assign(new Error('rate limit'), { name: 'RateLimitError' })

      let callCount = 0
      vi.mocked(generateText).mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(nonTimeoutError)
        return Promise.resolve({
          text: 'recovered',
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
          response: { messages: [{ role: 'assistant', content: 'recovered' }] },
        } as unknown as Awaited<ReturnType<typeof generateText>>)
      })

      const isRetryable = vi.fn().mockReturnValue(true)
      const onRetry = vi.fn()
      const resultPromise = send(
        makeRunner(profile),
        { profile: 'main', isRetryable, onRetry, backoffMs: () => 0 },
        ['Hello'],
      )

      await vi.runAllTimersAsync()
      const result = await resultPromise

      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenCalledTimes(1)
      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'recovered' })
    })

    it('onRetry receives correct attempt, maxAttempts, and reason', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 2, requestTimeoutMs: 30_000 }
      const nonTimeoutError = Object.assign(new Error('rate limit'), { name: 'RateLimitError' })

      let callCount = 0
      vi.mocked(generateText).mockImplementation(() => {
        callCount++
        if (callCount <= 2) return Promise.reject(nonTimeoutError)
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
          response: { messages: [{ role: 'assistant', content: 'ok' }] },
        } as unknown as Awaited<ReturnType<typeof generateText>>)
      })

      const onRetry = vi.fn()
      const resultPromise = send(
        makeRunner(profile),
        { profile: 'main', isRetryable: () => true, onRetry, backoffMs: () => 0 },
        ['Hello'],
      )

      await vi.runAllTimersAsync()
      await resultPromise

      expect(onRetry).toHaveBeenCalledTimes(2)
      expect(onRetry).toHaveBeenNthCalledWith(1, 0, 2, 'RateLimitError')
      expect(onRetry).toHaveBeenNthCalledWith(2, 1, 2, 'RateLimitError')
    })

    it('backoffMs return value is used as the sleep duration', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 1, requestTimeoutMs: 30_000 }
      const nonTimeoutError = Object.assign(new Error('fail'), { name: 'CustomError' })

      let callCount = 0
      vi.mocked(generateText).mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(nonTimeoutError)
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
          response: { messages: [{ role: 'assistant', content: 'ok' }] },
        } as unknown as Awaited<ReturnType<typeof generateText>>)
      })

      const backoffMs = vi.fn().mockReturnValue(500)
      const resultPromise = send(
        makeRunner(profile),
        { profile: 'main', isRetryable: () => true, backoffMs },
        ['Hello'],
      )

      await vi.advanceTimersByTimeAsync(500)
      await resultPromise

      expect(backoffMs).toHaveBeenCalledWith(0, 'CustomError')
    })

    it('falls back to 1000ms sleep when backoffMs is absent', async () => {
      const profile: ModelProfile = { ...baseProfile, maxRetries: 1, requestTimeoutMs: 30_000 }
      const nonTimeoutError = Object.assign(new Error('fail'), { name: 'SomeError' })

      let callCount = 0
      vi.mocked(generateText).mockImplementation(() => {
        callCount++
        if (callCount === 1) return Promise.reject(nonTimeoutError)
        return Promise.resolve({
          text: 'ok',
          usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
          response: { messages: [{ role: 'assistant', content: 'ok' }] },
        } as unknown as Awaited<ReturnType<typeof generateText>>)
      })

      const resultPromise = send(
        makeRunner(profile),
        { profile: 'main', isRetryable: () => true },
        ['Hello'],
      )

      // Should not have resolved yet (waiting 1000ms)
      await vi.advanceTimersByTimeAsync(999)
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1)

      await vi.advanceTimersByTimeAsync(1)
      await resultPromise

      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(2)
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
                response: { messages: [{ role: 'assistant', content: 'success after retry' }] },
              } as unknown as Awaited<ReturnType<typeof generateText>>)
            }
          }),
      )

      const promise = send(makeRunner(profile), { profile: 'main' }, ['Hello'])

      await vi.advanceTimersByTimeAsync(100) // trigger first timeout
      await vi.advanceTimersByTimeAsync(1000) // sleep before retry

      const result = await promise

      expect(result.messages).toHaveLength(2)
      expect(result.messages[0]).toEqual({ role: 'user', content: 'Hello' })
      expect(result.messages[1]).toEqual({ role: 'assistant', content: 'success after retry' })
    })
  })

  describe('isAvailable', () => {
    it('throws ProviderUnavailableError when isAvailable returns false', async () => {
      const profile: ModelProfile = { ...baseProfile, isAvailable: async () => false }

      await expect(send(makeRunner(profile), { profile: 'main' }, ['Hello'])).rejects.toThrow(
        ProviderUnavailableError,
      )
      expect(mockEnqueue).not.toHaveBeenCalled()
    })

    it('proceeds normally when isAvailable returns true', async () => {
      const profile: ModelProfile = { ...baseProfile, isAvailable: async () => true }
      mockGenerateText('response')

      const result = await send(makeRunner(profile), { profile: 'main' }, ['Hello'])

      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'response' })
    })

    it('proceeds normally when isAvailable is not defined (backward compat)', async () => {
      mockGenerateText('response')

      const result = await send(makeRunner(), { profile: 'main' }, ['Hello'])

      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'response' })
    })
  })

  describe('signature — string coercion', () => {
    it('coerces a plain string to { role: "user", content: string }', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, ['Hello world'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.messages).toContainEqual({ role: 'user', content: 'Hello world' })
    })

    it('passes a CoreMessage object through unchanged', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }
      const msg: CoreMessage = { role: 'user', content: 'already a message' }

      await send(makeRunner(), options, [msg])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.messages).toContainEqual({ role: 'user', content: 'already a message' })
    })
  })

  describe('toolTimeoutMs', () => {
    beforeEach(() => {
      vi.useFakeTimers()
      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    })

    afterEach(() => {
      vi.useRealTimers()
    })

    it('resets with toolTimeoutMs when step has tool calls', async () => {
      const profile: ModelProfile = { ...baseProfile, requestTimeoutMs: 1000 }
      const fakeStep = { text: '', toolCalls: [{ toolName: 'myTool' }], usage: {} }

      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockImplementation(
        async (opts: Parameters<typeof generateText>[0]) => {
          const onStepFinish = (opts as { onStepFinish?: (step: unknown) => Promise<void> })
            .onStepFinish
          await onStepFinish?.(fakeStep)
          return {
            text: 'done',
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
            response: { messages: [{ role: 'assistant', content: 'done' }] },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = { profile: 'main', toolTimeoutMs: 60_000 }
      const result = await send(makeRunner(profile), options, ['Hello'])

      // If toolTimeoutMs was used, the longer timeout means we should not have timed out
      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'done' })
    })

    it('uses requestTimeoutMs when step has no tool calls', async () => {
      const profile: ModelProfile = { ...baseProfile, requestTimeoutMs: 5000 }
      const fakeStep = { text: '', toolCalls: [], usage: {} }

      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockImplementation(
        async (opts: Parameters<typeof generateText>[0]) => {
          const onStepFinish = (opts as { onStepFinish?: (step: unknown) => Promise<void> })
            .onStepFinish
          await onStepFinish?.(fakeStep)
          return {
            text: 'done',
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
            response: { messages: [{ role: 'assistant', content: 'done' }] },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = { profile: 'main', toolTimeoutMs: 60_000 }
      const result = await send(makeRunner(profile), options, ['Hello'])

      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'done' })
    })
  })

  describe('progressiveToolDiscovery: false', () => {
    it('all tools passed upfront even when keywords do not appear in messages', async () => {
      mockGenerateText('response')
      const tool = makeTool('search', () => ['search'])
      const options: SessionOptions = {
        profile: 'main',
        tools: [tool],
        progressiveToolDiscovery: false,
      }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.tools).toBeDefined()
      expect(Object.keys(call.tools!)).toContain('search')
    })

    it('static array — full tool array passed as-is', async () => {
      mockGenerateText('response')
      const toolA = makeTool('tool-a', () => ['aaa'])
      const toolB = makeTool('tool-b', () => ['bbb'])
      const options: SessionOptions = {
        profile: 'main',
        tools: [toolA, toolB],
        progressiveToolDiscovery: false,
      }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.tools).toBeDefined()
      expect(Object.keys(call.tools!)).toEqual(expect.arrayContaining(['tool-a', 'tool-b']))
      expect(Object.keys(call.tools!)).toHaveLength(2)
    })

    it('closure tools — closure is still called but result is not keyword-filtered', async () => {
      mockGenerateText('response')
      const tool = makeTool('filtered-tool', () => ['secret-keyword'])
      const toolsClosure = vi.fn().mockReturnValue([tool])
      const options: SessionOptions = {
        profile: 'main',
        tools: toolsClosure,
        progressiveToolDiscovery: false,
      }

      await send(makeRunner(), options, ['Hello, no keywords here'])

      expect(toolsClosure).toHaveBeenCalled()
      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.tools).toBeDefined()
      expect(Object.keys(call.tools!)).toContain('filtered-tool')
    })

    it('per-step via prepareStep — all tools still passed on subsequent steps without keyword filtering', async () => {
      const toolA = makeTool('tool-a', () => ['aaa'])
      const toolB = makeTool('tool-b', () => ['bbb'])
      const toolsClosure = vi.fn().mockReturnValue([toolA, toolB])

      let capturedPrepareStep:
        | ((ctx: unknown) => Promise<{ tools?: Record<string, unknown> }>)
        | undefined

      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockImplementation(
        async (opts: Parameters<typeof generateText>[0]) => {
          capturedPrepareStep = (
            opts as { prepareStep?: (ctx: unknown) => Promise<{ tools?: Record<string, unknown> }> }
          ).prepareStep
          return {
            text: 'response',
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
            response: { messages: [{ role: 'assistant', content: 'response' }] },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )

      const options: SessionOptions = {
        profile: 'main',
        tools: toolsClosure,
        progressiveToolDiscovery: false,
      }
      await send(makeRunner(), options, ['Hello'])

      expect(capturedPrepareStep).toBeDefined()
      const ctx = {
        messages: [{ role: 'user', content: 'Hello, no keywords here' }],
        steps: [],
        model: {} as never,
        usage: {} as never,
      }
      const stepResult = await capturedPrepareStep!(ctx)

      expect(stepResult).toBeDefined()
      expect((stepResult as { tools?: Record<string, unknown> }).tools).toBeDefined()
      const stepTools = (stepResult as { tools?: Record<string, unknown> }).tools!
      expect(Object.keys(stepTools)).toContain('tool-a')
      expect(Object.keys(stepTools)).toContain('tool-b')
    })
  })

  describe('lazy tools', () => {
    it('calls the closure and uses the returned tools', async () => {
      mockGenerateText('response')
      const tool = makeTool('lazy-tool')
      const toolsClosure = vi.fn().mockReturnValue([tool])
      const options: SessionOptions = { profile: 'main', tools: toolsClosure }

      await send(makeRunner(), options, ['Hello'])

      expect(toolsClosure).toHaveBeenCalledTimes(1)
      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.tools).toBeDefined()
      expect(Object.keys(call.tools!)).toContain('lazy-tool')
    })

    it('calls the closure once for the initial tools parameter when prepareStep is not invoked', async () => {
      mockGenerateText('response')
      const tool = makeTool('once-tool')
      const toolsClosure = vi.fn().mockReturnValue([tool])
      const options: SessionOptions = { profile: 'main', tools: toolsClosure }

      await send(makeRunner(), options, ['Hello'])

      expect(toolsClosure).toHaveBeenCalledTimes(1)
    })
  })

  describe('per-step tool re-evaluation', () => {
    // This block tests the core fix for the bug where tools was evaluated once before the
    // retry loop in send(), so a mid-turn restrictTools() call had no effect on subsequent
    // steps within the same generateText invocation.

    function mockGenerateTextWithPrepareStep(captureRef: { stepConfig: unknown }) {
      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockImplementation(
        async (opts: Parameters<typeof generateText>[0]) => {
          const prepareStep = (opts as { prepareStep?: (ctx: unknown) => Promise<unknown> })
            .prepareStep
          const ctx = {
            messages: [{ role: 'user', content: 'Hello' }],
            steps: [],
            model: {} as never,
            usage: {} as never,
          }
          captureRef.stepConfig = await prepareStep?.(ctx as never)
          return {
            text: 'response',
            usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
            response: { messages: [{ role: 'assistant', content: 'response' }] },
          } as unknown as Awaited<ReturnType<typeof generateText>>
        },
      )
    }

    it('re-evaluates a tools closure in prepareStep so mid-turn restrictTools() takes effect', async () => {
      const toolA = makeTool('tool-a')
      const toolB = makeTool('tool-b')

      // Simulate restrictTools() being called mid-turn: first call returns both tools,
      // subsequent calls return only toolA (as if toolB was restricted away).
      let restricted = false
      const toolsClosure = vi.fn().mockImplementation(() => (restricted ? [toolA] : [toolA, toolB]))

      const capture: { stepConfig: unknown } = { stepConfig: undefined }
      mockGenerateTextWithPrepareStep(capture)

      const options: SessionOptions = { profile: 'main', tools: toolsClosure }
      await send(makeRunner(), options, ['Hello'])

      // Initial tools call gave both tools
      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(Object.keys(call.tools!)).toContain('tool-a')
      expect(Object.keys(call.tools!)).toContain('tool-b')

      // Now simulate what restrictTools() would do mid-turn, then fire prepareStep
      restricted = true
      const ctx = {
        messages: [{ role: 'user', content: 'Hello' }],
        steps: [],
        model: {} as never,
        usage: {} as never,
      }
      const stepConfig = (await (
        call as { prepareStep?: (ctx: unknown) => Promise<unknown> }
      ).prepareStep?.(ctx)) as { tools?: Record<string, unknown> }

      // prepareStep re-evaluated the closure — tool-b is gone
      expect(stepConfig?.tools).toBeDefined()
      expect(Object.keys(stepConfig!.tools!)).toContain('tool-a')
      expect(Object.keys(stepConfig!.tools!)).not.toContain('tool-b')
    })

    it('OLD BEHAVIOUR PROOF: static toolSet built once would keep tool-b even after restriction', async () => {
      // This test documents why the old code was broken. If you build the toolSet once before
      // the loop and pass it statically, the restricted set never reaches the model.
      const toolA = makeTool('tool-a')
      const toolB = makeTool('tool-b')

      let restricted = false
      const toolsClosure = vi.fn().mockImplementation(() => (restricted ? [toolA] : [toolA, toolB]))

      // Replicate the old broken pattern: evaluate the closure once, build toolSet statically
      const initialTools = toolsClosure()
      const staticToolSet = Object.fromEntries(
        initialTools.map(({ name, keywords: _kw, ...rest }) => [name, rest]),
      )

      // At this point restricted becomes true (restrictTools() was called mid-turn)
      restricted = true

      // The static toolSet still contains tool-b — this was the bug
      expect(Object.keys(staticToolSet)).toContain('tool-b')

      // But re-evaluating the closure (what the fix does) gives only tool-a
      const freshTools = toolsClosure()
      const freshToolSet = Object.fromEntries(
        freshTools.map(({ name, keywords: _kw, ...rest }) => [name, rest]),
      )
      expect(Object.keys(freshToolSet)).not.toContain('tool-b')
      expect(Object.keys(freshToolSet)).toContain('tool-a')
    })

    it('does not inject tools into prepareStep result when tools is a static array', async () => {
      const toolA = makeTool('tool-a')
      const toolB = makeTool('tool-b')

      const capture: { stepConfig: unknown } = { stepConfig: undefined }
      mockGenerateTextWithPrepareStep(capture)

      const options: SessionOptions = { profile: 'main', tools: [toolA, toolB] }
      await send(makeRunner(), options, ['Hello'])

      // Static array: prepareStep returns no tools override — AI SDK keeps the initial toolSet
      const stepConfig = capture.stepConfig as { tools?: unknown }
      expect(stepConfig?.tools).toBeUndefined()
    })
  })

  describe('maxSteps', () => {
    it('sets stopWhen when provided on SessionOptions', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main', maxSteps: 5 }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBeDefined()
      expect(call.stopWhen).toBeTypeOf('function')
    })

    it('uses profile maxSteps when not set on SessionOptions', async () => {
      const profile: ModelProfile = { ...baseProfile, maxSteps: 3 }
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(profile), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBeDefined()
      expect(call.stopWhen).toBeTypeOf('function')
    })

    it('SessionOptions.maxSteps overrides profile maxSteps', async () => {
      // Both are set — session wins. Either way a stopWhen function is produced.
      // Behavioural difference (step count) is enforced by the AI SDK, not by us.
      const profile: ModelProfile = { ...baseProfile, maxSteps: 3 }
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main', maxSteps: 10 }

      await send(makeRunner(profile), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBeDefined()
      expect(call.stopWhen).toBeTypeOf('function')
    })

    it('explicit stopWhen wins over maxSteps', async () => {
      const explicitStopWhen = vi.fn().mockReturnValue(Promise.resolve(false))
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main', maxSteps: 5, stopWhen: explicitStopWhen }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBe(explicitStopWhen)
    })

    it('stopWhen is undefined when neither maxSteps nor stopWhen is set', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect(call.stopWhen).toBeUndefined()
    })
  })

  describe('maxOutputTokens', () => {
    it('passes maxOutputTokens to generateText when set on SessionOptions', async () => {
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main', maxOutputTokens: 4096 }

      await send(makeRunner(), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect((call as { maxOutputTokens?: number }).maxOutputTokens).toBe(4096)
    })

    it('uses profile maxOutputTokens when not set on SessionOptions', async () => {
      const profile: ModelProfile = { ...baseProfile, maxOutputTokens: 2048 }
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main' }

      await send(makeRunner(profile), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect((call as { maxOutputTokens?: number }).maxOutputTokens).toBe(2048)
    })

    it('SessionOptions.maxOutputTokens overrides profile maxOutputTokens', async () => {
      const profile: ModelProfile = { ...baseProfile, maxOutputTokens: 2048 }
      mockGenerateText('response')
      const options: SessionOptions = { profile: 'main', maxOutputTokens: 8192 }

      await send(makeRunner(profile), options, ['Hello'])

      const call = vi.mocked(generateText).mock.calls[0][0]
      expect((call as { maxOutputTokens?: number }).maxOutputTokens).toBe(8192)
    })
  })

  describe('tool call messages', () => {
    function mockMultiStepGeneration(responseMessages: ModelMessage[]) {
      mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
      vi.mocked(generateText).mockResolvedValue({
        text: 'final response',
        usage: { inputTokens: 20, outputTokens: 10, cachedInputTokens: 30 },
        response: { messages: responseMessages },
      } as unknown as Awaited<ReturnType<typeof generateText>>)
    }

    it('result.messages includes all tool call and tool result entries', async () => {
      const toolCallMsg: ModelMessage = {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'lookup', input: { q: 'x' } }],
      }
      const toolResultMsg: ModelMessage = {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'lookup', output: '42' }],
      }
      const finalMsg: ModelMessage = { role: 'assistant', content: 'The answer is 42' }

      mockMultiStepGeneration([toolCallMsg, toolResultMsg, finalMsg])

      const result = await send(makeRunner(), { profile: 'main' }, ['What is x?'])

      // user + assistant(tool-call) + tool(result) + assistant(final)
      expect(result.messages).toHaveLength(4)
      expect(result.messages[0]).toEqual({ role: 'user', content: 'What is x?' })
      expect(result.messages[1]).toEqual(toolCallMsg)
      expect(result.messages[2]).toEqual(toolResultMsg)
      expect(result.messages[3]).toEqual(finalMsg)
    })

    it('result.messages.at(-1) is the final assistant message after tool use', async () => {
      const finalMsg: ModelMessage = { role: 'assistant', content: 'Done.' }
      mockMultiStepGeneration([
        {
          role: 'assistant',
          content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'run', input: {} }],
        },
        {
          role: 'tool',
          content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'run', output: 'ok' }],
        },
        finalMsg,
      ])

      const result = await send(makeRunner(), { profile: 'main' }, ['Go'])

      expect(result.messages.at(-1)).toEqual(finalMsg)
    })

    it('second turn receives the full tool interaction history from the first turn', async () => {
      const toolCallMsg: ModelMessage = {
        role: 'assistant',
        content: [{ type: 'tool-call', toolCallId: 'tc1', toolName: 'lookup', input: { q: 'x' } }],
      }
      const toolResultMsg: ModelMessage = {
        role: 'tool',
        content: [{ type: 'tool-result', toolCallId: 'tc1', toolName: 'lookup', output: '42' }],
      }
      const assistantReply: ModelMessage = { role: 'assistant', content: 'The answer is 42' }

      mockMultiStepGeneration([toolCallMsg, toolResultMsg, assistantReply])
      const first = await send(makeRunner(), { profile: 'main' }, ['What is x?'])

      expect(first.messages).toHaveLength(4)

      // Set up second turn response
      vi.mocked(generateText).mockResolvedValueOnce({
        text: 'Still 42',
        usage: { inputTokens: 10, outputTokens: 5, cachedInputTokens: 15 },
        response: { messages: [{ role: 'assistant', content: 'Still 42' }] },
      } as unknown as Awaited<ReturnType<typeof generateText>>)

      await send(makeRunner(), { profile: 'main' }, [...first.messages, 'Are you sure?'])

      const secondCall = vi.mocked(generateText).mock.calls[1][0]
      // The second call must include the tool call and tool result from the first turn
      expect(secondCall.messages).toContainEqual(toolCallMsg)
      expect(secondCall.messages).toContainEqual(toolResultMsg)
      expect(secondCall.messages).toContainEqual(assistantReply)
    })
  })

  describe('composite profiles', () => {
    const secondProfile: ModelProfile = {
      ...baseProfile,
      provider: 'anthropic',
      model: 'claude-haiku',
    }

    function makeCompositeRunner(profiles: Record<string, AnyProfile>): RunnerInstance {
      return {
        config: {
          profiles,
          secrets: { openRouter: 'key', anthropic: 'key' },
        },
        registry: {
          getProvider: mockGetProvider,
          getQueue: mockGetQueue,
        } as unknown as RunnerInstance['registry'],
      }
    }

    it('uses first candidate when it is available', async () => {
      mockGenerateText('from first')
      const runner = makeCompositeRunner({
        composite: { kind: 'composite', candidates: ['first', 'second'] },
        first: baseProfile,
        second: secondProfile,
      })

      const result = await send(runner, { profile: 'composite' }, ['Hello'])

      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'from first' })
      // generateText called only once — never tried second
      expect(vi.mocked(generateText)).toHaveBeenCalledTimes(1)
    })

    it('falls back to second candidate when first is unavailable', async () => {
      mockGenerateText('from second')
      const unavailableFirst: ModelProfile = {
        ...baseProfile,
        isAvailable: async () => false,
      }
      const runner = makeCompositeRunner({
        composite: { kind: 'composite', candidates: ['first', 'second'] },
        first: unavailableFirst,
        second: secondProfile,
      })

      const result = await send(runner, { profile: 'composite' }, ['Hello'])

      expect(result.messages.at(-1)).toEqual({ role: 'assistant', content: 'from second' })
    })

    it('throws last error when all candidates fail', async () => {
      const unavailableA: ModelProfile = { ...baseProfile, isAvailable: async () => false }
      const unavailableB: ModelProfile = { ...secondProfile, isAvailable: async () => false }
      const runner = makeCompositeRunner({
        composite: { kind: 'composite', candidates: ['a', 'b'] },
        a: unavailableA,
        b: unavailableB,
      })

      await expect(send(runner, { profile: 'composite' }, ['Hello'])).rejects.toThrow(
        ProviderUnavailableError,
      )
    })

    it('throws immediately when a candidate is itself composite', async () => {
      const runner = makeCompositeRunner({
        composite: { kind: 'composite', candidates: ['nested'] },
        nested: { kind: 'composite', candidates: ['x'] },
        x: baseProfile,
      })

      await expect(send(runner, { profile: 'composite' }, ['Hello'])).rejects.toThrow(
        /[Nn]ested composite/,
      )
    })
  })
})
