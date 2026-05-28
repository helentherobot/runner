import { describe, it, expect, vi } from 'vitest'
import { OpenAIProvider } from '../../src/providers/openai.js'
import type { LanguageModel } from 'ai'

describe('OpenAIProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new OpenAIProvider('test-key', { client: mockClient as never })
    const result = provider.model('gpt-4o')

    expect(mockClient).toHaveBeenCalledWith('gpt-4o')
    expect(result).toBe(mockModel)
  })
})
