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
  providerOptions?: Record<string, unknown>
}

export interface RunnerConfig {
  profiles: Record<string, ModelProfile>
  secrets?: {
    openRouter?: string
    google?: string
    openAi?: string
    anthropic?: string
  }
}
