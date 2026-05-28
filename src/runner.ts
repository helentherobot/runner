import type { RunnerConfig } from './types.js'
import type { Recipe, RunResult, RunOptions } from './recipes/types.js'
import { ProviderRegistry } from './providers/registry.js'
import { runRecipe } from './recipes/run-recipe.js'

export class Runner {
  readonly config: RunnerConfig
  readonly #registry: ProviderRegistry

  constructor(config: RunnerConfig) {
    this.config = config
    this.#registry = new ProviderRegistry(config)
  }

  get registry(): ProviderRegistry {
    return this.#registry
  }

  async run<TArgs extends unknown[]>(
    r: Recipe<TArgs>,
    args: TArgs,
    options?: RunOptions,
  ): Promise<RunResult> {
    return runRecipe(this, r, args, options)
  }
}
