import { describe, it, expect, vi } from 'vitest'
import type { LanguageModel } from 'ai'

vi.mock('@ai-sdk/openai', () => ({
  createOpenAI: vi.fn(),
}))

import { createOpenAI } from '@ai-sdk/openai'
import { LmStudioProvider } from '../../src/providers/lm-studio.js'

describe('LmStudioProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new LmStudioProvider(undefined, { client: mockClient as never })
    const result = provider.model('llama3.2-3b')

    expect(mockClient).toHaveBeenCalledWith('llama3.2-3b')
    expect(result).toBe(mockModel)
  })

  it('uses the default baseURL when none is provided', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)
    vi.mocked(createOpenAI).mockReturnValue(mockClient as never)

    const provider = new LmStudioProvider()
    provider.model('llama3.2-3b')

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://localhost:1234/v1',
    })
  })

  it('passes a custom baseURL to createOpenAI', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)
    vi.mocked(createOpenAI).mockReturnValue(mockClient as never)

    const provider = new LmStudioProvider('http://192.168.1.10:1234/v1')
    provider.model('llama3.2-3b')

    expect(createOpenAI).toHaveBeenCalledWith({
      apiKey: 'lm-studio',
      baseURL: 'http://192.168.1.10:1234/v1',
    })
  })

  it('always uses the placeholder apiKey "lm-studio"', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)
    vi.mocked(createOpenAI).mockReturnValue(mockClient as never)

    new LmStudioProvider()

    const callArgs = vi.mocked(createOpenAI).mock.calls[0][0] as { apiKey: string }
    expect(callArgs.apiKey).toBe('lm-studio')
  })
})
