import { describe, it, expect, vi } from 'vitest'
import type { LanguageModel } from 'ai'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(),
}))

import { createOpenAI } from '@ai-sdk/openai'
import { DeepSeekProvider } from '../../src/providers/deepseek.js'

describe('DeepSeekProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new DeepSeekProvider('test-key', { client: mockClient as never })
    const result = provider.model('deepseek-v4-flash')

    expect(mockClient).toHaveBeenCalledWith('deepseek-v4-flash')
    expect(result).toBe(mockModel)
  })

  it('passes apiKey and baseURL to createOpenAI when no client is injected', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)
    vi.mocked(createOpenAI).mockReturnValue(mockClient as never)

    const provider = new DeepSeekProvider('my-key')
    provider.model('deepseek-v4-flash')

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: 'my-key',
      baseURL: 'https://api.deepseek.com',
    })
  })
})
