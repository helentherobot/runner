import { describe, it, expect } from 'vitest'
import { zodSchema } from 'ai'
import type { ModelMessage } from 'ai'
import { discoverTools } from '../../src/session/discover-tools.js'
import type { DiscoverableTool } from '../../src/session/types.js'
import { z } from 'zod'

function makeTool(name: string, keywords?: () => string[]): DiscoverableTool {
  return {
    name,
    description: `Tool: ${name}`,
    inputSchema: zodSchema(z.object({})),
    ...(keywords ? { keywords } : {}),
  }
}

function userMessage(content: string): ModelMessage {
  return { role: 'user', content }
}

function assistantMessage(content: string): ModelMessage {
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

  it('reveals a matching tool when its keyword appears in a user message', () => {
    const tool = makeTool('notes', () => ['note', 'notes'])
    const messages: ModelMessage[] = [userMessage('make a new note about my meeting')]

    const result = discoverTools(messages, [tool])

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('notes')
  })

  it('reveals a matching tool when its keyword appears in an assistant message', () => {
    const tool = makeTool('search', () => ['search'])
    const messages: ModelMessage[] = [assistantMessage('I can search the web for you')]

    const result = discoverTools(messages, [tool])

    expect(result).toHaveLength(1)
    expect(result[0].name).toBe('search')
  })

  it('hides a tool when none of its keywords appear in any message', () => {
    const tool = makeTool('search', () => ['search', 'lookup'])
    const messages: ModelMessage[] = [
      userMessage('The weather is nice today'),
      assistantMessage('It sure is!'),
    ]

    const result = discoverTools(messages, [tool])

    expect(result).toHaveLength(0)
  })

  it('always returns a tool whose keywords() returns an empty array', () => {
    const tool = makeTool('always', () => [])
    const messages: ModelMessage[] = []

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
