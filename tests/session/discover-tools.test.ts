import { describe, it, expect } from 'vitest'
import type { CoreMessage } from 'ai'
import { discoverTools } from '../../src/session/discover-tools.js'
import type { DiscoverableTool } from '../../src/session/types.js'
import { z } from 'zod'

function makeTool(name: string, keywords?: () => string[]): DiscoverableTool {
  return {
    name,
    description: `Tool: ${name}`,
    parameters: z.object({}),
    ...(keywords ? { keywords } : {}),
  }
}

function assistantMessage(content: string): CoreMessage {
  return { role: 'assistant', content }
}

describe('discoverTools()', () => {
  it('returns only tools without keywords when messages are empty', () => {
    const toolWithKeywords = makeTool('search', () => ['search', 'find'])
    const toolWithoutKeywords = makeTool('greet')

    const result = discoverTools([], [toolWithKeywords, toolWithoutKeywords])

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('greet')
  })

  it('reveals a matching tool when its keyword appears in assistant history', () => {
    const tool = makeTool('search', () => ['search'])
    const messages: CoreMessage[] = [assistantMessage('I can search the web for you')]

    const result = discoverTools(messages, [tool])

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('search')
  })

  it('hides a tool when none of its keywords appear in assistant history', () => {
    const tool = makeTool('search', () => ['search', 'lookup'])
    const messages: CoreMessage[] = [assistantMessage('The weather is nice today')]

    const result = discoverTools(messages, [tool])

    expect(result).toHaveLength(0)
  })

  it('always returns a tool whose keywords() returns an empty array', () => {
    const tool = makeTool('always', () => [])
    const messages: CoreMessage[] = []

    const result = discoverTools(messages, [tool])

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('always')
  })

  it('always returns a tool whose keywords() returns an empty array even without history', () => {
    const tool = makeTool('always', () => [])

    const result = discoverTools([], [tool])

    expect(result).toHaveLength(1)
  })
})
