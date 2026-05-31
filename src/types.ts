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
