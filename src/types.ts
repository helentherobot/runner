import type { ProviderOptions } from '@ai-sdk/provider-utils'

export interface QueueConfig {
  maxConcurrent: number
  requestsPerMinute: number
  affinityMode: boolean
  warmup: boolean
}

export interface ModelProfile {
  provider: string
  model: string
  contextWindowTokens: number
  requestTimeoutMs: number
  queue: QueueConfig
  costs?: {
    inputPer1M: number
    outputPer1M: number
  }
  providerOptions?: ProviderOptions
  maxRetries?: number
  /**
   * Maximum number of agentic steps (tool call → result → reply cycles) per send() call.
   * Maps to stopWhen: stepCountIs(maxSteps) in the underlying generateText call.
   * Overridden by SessionOptions.maxSteps if provided.
   * Defaults to 1 (no tool loops) if neither this nor SessionOptions.stopWhen is set.
   */
  maxSteps?: number
  /**
   * When false, all tools are passed on every turn without keyword filtering.
   * Keeps the system prompt stable across turns, which is better for prompt caching.
   * When true (default), tools are filtered each turn via keyword matching in discoverTools().
   */
  progressiveToolDiscovery?: boolean
  /**
   * Optional availability check. When defined, called before enqueuing a request.
   * If it returns false, a ProviderUnavailableError is thrown immediately.
   */
  isAvailable?: () => Promise<boolean>
}

export interface ResolvedSecrets {
  openRouter?: string
  google?: string
  openAi?: string
  anthropic?: string
  deepSeek?: string
  lmStudioBaseUrl?: string
}

export interface RunnerConfig {
  profiles: Record<string, ModelProfile>
  secrets?: ResolvedSecrets
}
