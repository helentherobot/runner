import type { RunnerConfig } from '../types.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { Recipe, RunResult, RunOptions } from './types.js'
export interface RunnerInstance {
  config: RunnerConfig
  registry: ProviderRegistry
}
export declare function runRecipe<TArgs extends unknown[]>(
  runner: RunnerInstance,
  r: Recipe<TArgs>,
  args: TArgs,
  options?: RunOptions,
): Promise<RunResult>
//# sourceMappingURL=run-recipe.d.ts.map
