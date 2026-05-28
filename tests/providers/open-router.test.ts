import { describe, it, expect, vi } from 'vitest'
import { OpenRouterProvider } from '../../src/providers/open-router.js'
import type { LanguageModel } from 'ai'

describe('OpenRouterProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new OpenRouterProvider('test-key', { client: mockClient as never })
    const result = provider.model('openai/gpt-4o')

    expect(mockClient).toHaveBeenCalledWith('openai/gpt-4o')
    expect(result).toBe(mockModel)
  })
})
