import type { LanguageModel } from 'ai'
import type { Provider } from './types.js'
export declare class AnthropicAgentProvider implements Provider {
  #private
  constructor(credentialsPath?: string)
  model(key: string): LanguageModel
}
//# sourceMappingURL=anthropic-agent.d.ts.map
