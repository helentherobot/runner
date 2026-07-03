import type { LanguageModel } from 'ai'
import { createOpenAI } from '@ai-sdk/openai'
import type { Provider } from './types.js'
export declare class LmStudioProvider implements Provider {
  #private
  constructor(
    baseURL?: string,
    deps?: {
      client?: ReturnType<typeof createOpenAI>
    },
  )
  model(key: string): LanguageModel
}
//# sourceMappingURL=lm-studio.d.ts.map
