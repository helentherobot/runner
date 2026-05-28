import { describe, it, expect, vi } from 'vitest'
import { GoogleProvider } from '../../src/providers/google.js'
import type { LanguageModel } from 'ai'

describe('GoogleProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new GoogleProvider('test-key', { client: mockClient as never })
    const result = provider.model('gemini-2.0-flash')

    expect(mockClient).toHaveBeenCalledWith('gemini-2.0-flash')
    expect(result).toBe(mockModel)
  })
})
