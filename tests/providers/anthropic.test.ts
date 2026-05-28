import { describe, it, expect, vi } from 'vitest'
import { AnthropicProvider } from '../../src/providers/anthropic.js'
import type { LanguageModel } from 'ai'

describe('AnthropicProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new AnthropicProvider('test-key', { client: mockClient as never })
    const result = provider.model('claude-sonnet-4-5')

    expect(mockClient).toHaveBeenCalledWith('claude-sonnet-4-5')
    expect(result).toBe(mockModel)
  })
})
