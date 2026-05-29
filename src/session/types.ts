import type { Tool, ModelMessage, StepResult, StopCondition, ToolSet } from 'ai'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type DiscoverableTool = Tool<any, any> & {
  name: string
  keywords?(): string[]
}

export interface SessionOptions {
  profile: string
  systemPrompt?: string
  tools?: DiscoverableTool[] | (() => DiscoverableTool[])
  scope?: string
  abortSignal?: AbortSignal
  prepareStep?: (ctx: {
    messages: ModelMessage[]
    steps: StepResult<ToolSet>[]
  }) => Promise<{ messages?: ModelMessage[] } | void> | { messages?: ModelMessage[] } | void
  onStepFinish?: (step: StepResult<ToolSet>) => void | Promise<void>
  stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[]
  isRetryable?: (error: unknown) => boolean
  onRetry?: (attempt: number, maxAttempts: number, reason: string) => void
  backoffMs?: (attempt: number, reason: string) => number
  toolTimeoutMs?: number
}

export interface SendResult {
  messages: ModelMessage[]
  usage: {
    inputTokens: number
    outputTokens: number
    totalCostUsd: number | undefined
  }
}
