import type { CoreTool, CoreMessage } from 'ai'

export interface DiscoverableTool extends CoreTool {
  name: string
  keywords?(): string[]
}

export interface SessionOptions {
  profile: string
  systemPrompt?: string
  tools?: DiscoverableTool[]
}

export interface SendResult {
  messages: CoreMessage[]
  usage: {
    inputTokens: number
    outputTokens: number
    totalCostUsd: number | undefined
  }
}
