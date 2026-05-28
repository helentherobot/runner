import { describe, it, expect, vi } from 'vitest'
import { OllamaProvider } from '../../src/providers/ollama.js'
import type { LanguageModel } from 'ai'

describe('OllamaProvider', () => {
  it('returns the model from the injected client', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new OllamaProvider('http://localhost:11434', { client: mockClient as never })
    const result = provider.model('llama3.2')

    expect(mockClient).toHaveBeenCalledWith('llama3.2')
    expect(result).toBe(mockModel)
  })

  it('defaults baseURL to http://localhost:11434', () => {
    const mockModel = {} as LanguageModel
    const mockClient = vi.fn().mockReturnValue(mockModel)

    const provider = new OllamaProvider(undefined, { client: mockClient as never })
    provider.model('llama3.2')

    expect(mockClient).toHaveBeenCalledWith('llama3.2')
  })
})
