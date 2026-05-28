import type { CoreMessage } from 'ai'
import type { DiscoverableTool } from './types.js'

export function discoverTools(
  messages: CoreMessage[],
  tools: DiscoverableTool[],
): DiscoverableTool[] {
  const assistantText = messages
    .filter((m) => m.role === 'assistant')
    .map((m) => (typeof m.content === 'string' ? m.content : ''))
    .join(' ')

  return tools.filter((tool) => {
    if (!tool.keywords) {
      return true
    }

    const keywords = tool.keywords()

    if (keywords.length === 0) {
      return true
    }

    return keywords.some((kw) => assistantText.includes(kw))
  })
}
