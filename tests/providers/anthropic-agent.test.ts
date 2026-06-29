import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { LanguageModel } from 'ai'

const { mockCreateAnthropic, mockReadFile } = vi.hoisted(() => ({
  mockCreateAnthropic: vi.fn(),
  mockReadFile: vi.fn(),
}))

vi.mock('@ai-sdk/anthropic', () => ({
  createAnthropic: mockCreateAnthropic,
}))

vi.mock('node:fs', async () => {
  const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
  return { ...actual, readFileSync: mockReadFile }
})

import { AnthropicAgentProvider } from '../../src/providers/anthropic-agent.js'

describe('AnthropicAgentProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('reads token from credentials file and creates client with authToken', () => {
    const credentials = { claudeAiOauth: { accessToken: 'test-oauth-token' } }
    mockReadFile.mockReturnValue(JSON.stringify(credentials))

    const mockClient = vi.fn()
    mockCreateAnthropic.mockReturnValue(mockClient)

    const provider = new AnthropicAgentProvider('/fake/path/.credentials.json')

    expect(mockReadFile).toHaveBeenCalledWith('/fake/path/.credentials.json', 'utf-8')
    expect(mockCreateAnthropic).toHaveBeenCalledWith({
      authToken: 'test-oauth-token',
    })

    const mockModel = {} as LanguageModel
    mockClient.mockReturnValue(mockModel)
    const result = provider.model('claude-sonnet-4-5')
    expect(mockClient).toHaveBeenCalledWith('claude-sonnet-4-5')
    expect(result).toBe(mockModel)
  })

  it('throws if credentials file is missing', () => {
    mockReadFile.mockImplementation(() => {
      throw new Error('ENOENT')
    })

    expect(() => new AnthropicAgentProvider('/missing/path')).toThrow(
      'Credentials file not found: /missing/path',
    )
  })

  it('throws if accessToken is absent in file', () => {
    mockReadFile.mockReturnValue(JSON.stringify({ claudeAiOauth: {} }))

    expect(() => new AnthropicAgentProvider('/fake/path')).toThrow(
      'No OAuth access token found at claudeAiOauth.accessToken',
    )
  })

  it('throws if claudeAiOauth key is missing entirely', () => {
    mockReadFile.mockReturnValue(JSON.stringify({}))

    expect(() => new AnthropicAgentProvider('/fake/path')).toThrow(
      'No OAuth access token found at claudeAiOauth.accessToken',
    )
  })
})
