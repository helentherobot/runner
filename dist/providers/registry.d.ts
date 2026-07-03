import type { RunnerConfig, ResolvedSecrets, ModelProfile } from '../types.js'
import type { Provider } from './types.js'
import { ProviderQueue } from './queue.js'
export declare class ProviderRegistry {
  #private
  constructor(config: RunnerConfig)
  getProvider(key: string, secrets: ResolvedSecrets): Provider
  getQueue(profileKey: string, profile: ModelProfile): ProviderQueue
}
//# sourceMappingURL=registry.d.ts.map
