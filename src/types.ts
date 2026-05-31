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
   * When false, all tools are passed on every turn without keyword filtering.
   * Keeps the system prompt stable across turns, which is better for prompt caching.
   * When true (default), tools are filtered each turn via keyword matching in discoverTools().
   */
  progressiveToolDiscovery?: boolean
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
