import type { Tool, ModelMessage } from 'ai'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DiscoverableTool = Tool<any, any> & {
  name: string
  keywords?(): string[]
}

export interface SessionOptions {
  profile: string
  systemPrompt?: string
  tools?: DiscoverableTool[]
  scope?: string
}

export interface SendResult {
  messages: ModelMessage[]
  usage: {
    inputTokens: number
    outputTokens: number
    totalCostUsd: number | undefined
  }
}
