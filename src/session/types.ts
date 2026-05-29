import type { Tool, ModelMessage, CoreMessage, StepResult, StopCondition } from 'ai'

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
  abortSignal?: AbortSignal
  prepareStep?: (ctx: {
    messages: CoreMessage[]
    steps: StepResult[]
  }) => Promise<{ messages?: CoreMessage[] } | void> | { messages?: CoreMessage[] } | void
  onStepFinish?: (step: StepResult) => void | Promise<void>
  stopWhen?: StopCondition | StopCondition[]
  isRetryable?: (error: unknown) => boolean
  onRetry?: (attempt: number, maxAttempts: number, reason: string) => void
  backoffMs?: (attempt: number, reason: string) => number
}

export interface SendResult {
  messages: ModelMessage[]
  usage: {
    inputTokens: number
    outputTokens: number
    totalCostUsd: number | undefined
  }
}
