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
  /**
   * When false, all tools are passed on every turn without keyword filtering.
   * Keeps the system prompt stable across turns, which is better for prompt caching.
   * When true (default), tools are filtered each turn via keyword matching in discoverTools().
   */
  progressiveToolDiscovery?: boolean
  prepareStep?: (ctx: {
    messages: ModelMessage[]
    steps: StepResult<ToolSet>[]
  }) => Promise<{ messages?: ModelMessage[] } | void> | { messages?: ModelMessage[] } | void
  onStepFinish?: (step: StepResult<ToolSet>) => void | Promise<void>
  stopWhen?: StopCondition<ToolSet> | StopCondition<ToolSet>[]
  /**
   * Maximum number of agentic steps (tool call → result → reply cycles) per send() call.
   * Overrides ModelProfile.maxSteps when provided.
   * Ignored when stopWhen is also provided — explicit stop conditions win.
   * Defaults to 1 (no tool loops) if neither this nor stopWhen is set.
   */
  maxSteps?: number
  /**
   * Maximum number of output tokens per generateText call.
   * Overrides ModelProfile.maxOutputTokens when provided.
   */
  maxOutputTokens?: number
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
