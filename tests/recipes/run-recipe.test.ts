import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { RunnerInstance } from '../../src/recipes/run-recipe.js'
import type { Recipe } from '../../src/recipes/types.js'
import type { ModelProfile } from '../../src/types.js'

const mockEnqueue = vi.fn()
const mockModel = {}
const mockGetProvider = vi.fn().mockReturnValue({ model: vi.fn().mockReturnValue(mockModel) })
const mockGetQueue = vi.fn().mockReturnValue({ enqueue: mockEnqueue })

vi.mock('ai', () => ({
  generateText: vi.fn(),
}))

import { generateText } from 'ai'
import { runRecipe } from '../../src/recipes/run-recipe.js'

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

beforeEach(() => {
  vi.clearAllMocks()
  mockGetProvider.mockReturnValue({ model: vi.fn().mockReturnValue(mockModel) })
  mockGetQueue.mockReturnValue({ enqueue: mockEnqueue })
})

describe('runRecipe()', () => {
  it('calls the prompt factory with the provided args', async () => {
    const promptFn = vi.fn().mockReturnValue('tell me about cats')
    const r: Recipe<[string, number]> = {
      profile: 'main',
      prompt: promptFn,
    }

    mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    vi.mocked(generateText).mockResolvedValue({
      text: 'cats are great',
      usage: { inputTokens: 10, outputTokens: 20, cachedInputTokens: 30 },
    } as unknown as Awaited<ReturnType<typeof generateText>>)

    await runRecipe(makeRunner(), r, ['cats', 3])

    expect(promptFn).toHaveBeenCalledWith('cats', 3)
  })

  it('returns text matching the mocked generateText response', async () => {
    const r: Recipe<[]> = {
      profile: 'main',
      prompt: () => 'hello',
    }

    mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    vi.mocked(generateText).mockResolvedValue({
      text: 'world',
      usage: { inputTokens: 5, outputTokens: 10, cachedInputTokens: 15 },
    } as unknown as Awaited<ReturnType<typeof generateText>>)

    const result = await runRecipe(makeRunner(), r, [])

    expect(result.text).toBe('world')
  })

  it('returns usage.inputTokens and outputTokens from the mock', async () => {
    const r: Recipe<[]> = {
      profile: 'main',
      prompt: () => 'hello',
    }

    mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    vi.mocked(generateText).mockResolvedValue({
      text: 'hi',
      usage: { inputTokens: 42, outputTokens: 17, cachedInputTokens: 59 },
    } as unknown as Awaited<ReturnType<typeof generateText>>)

    const result = await runRecipe(makeRunner(), r, [])

    expect(result.usage.inputTokens).toBe(42)
    expect(result.usage.outputTokens).toBe(17)
  })

  it('computes totalCostUsd from profile cost rates', async () => {
    const r: Recipe<[]> = {
      profile: 'main',
      prompt: () => 'hello',
    }

    mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    vi.mocked(generateText).mockResolvedValue({
      text: 'hi',
      usage: { inputTokens: 1_000_000, outputTokens: 1_000_000, cachedInputTokens: 2_000_000 },
    } as unknown as Awaited<ReturnType<typeof generateText>>)

    const result = await runRecipe(makeRunner(), r, [])

    // inputPer1M=5, outputPer1M=15 → 1M*5 + 1M*15 = 20
    expect(result.usage.totalCostUsd).toBeCloseTo(20)
  })

  it('returns undefined totalCostUsd when profile has no costs', async () => {
    const profileNoCosts: ModelProfile = { ...baseProfile, costs: undefined }
    const r: Recipe<[]> = {
      profile: 'main',
      prompt: () => 'hello',
    }

    mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    vi.mocked(generateText).mockResolvedValue({
      text: 'hi',
      usage: { inputTokens: 100, outputTokens: 50, cachedInputTokens: 150 },
    } as unknown as Awaited<ReturnType<typeof generateText>>)

    const result = await runRecipe(makeRunner(profileNoCosts), r, [])

    expect(result.usage.totalCostUsd).toBeUndefined()
  })

  it('enqueues via the queue with the profile key as scope', async () => {
    const r: Recipe<[]> = {
      profile: 'main',
      prompt: () => 'hello',
    }

    mockEnqueue.mockImplementation((_scope: string, fn: () => Promise<unknown>) => fn())
    vi.mocked(generateText).mockResolvedValue({
      text: 'hi',
      usage: { inputTokens: 5, outputTokens: 5, cachedInputTokens: 10 },
    } as unknown as Awaited<ReturnType<typeof generateText>>)

    await runRecipe(makeRunner(), r, [])

    expect(mockEnqueue).toHaveBeenCalledWith('main', expect.any(Function))
  })

  it('throws when the profile key is not found in config', async () => {
    const r: Recipe<[]> = {
      profile: 'nonexistent',
      prompt: () => 'hello',
    }

    await expect(runRecipe(makeRunner(), r, [])).rejects.toThrow('Unknown profile: nonexistent')
  })
})
