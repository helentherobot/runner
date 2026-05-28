export interface Recipe<TArgs extends unknown[] = unknown[]> {
  profile: string
  prompt: (...args: TArgs) => string
  maxOutputTokens?: number
}

export interface RunResult {
  text: string
  usage: {
    inputTokens: number
    outputTokens: number
    totalCostUsd: number | undefined
  }
}
