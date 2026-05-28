import type { Tool, CoreMessage } from 'ai'
import type { ZodTypeAny } from 'zod'

export type DiscoverableTool = Tool<ZodTypeAny, unknown> & {
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
