import type { LanguageModel } from 'ai'

export interface Provider {
  model(key: string): LanguageModel
}
