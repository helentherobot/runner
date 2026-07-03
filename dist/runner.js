import { ProviderRegistry } from './providers/registry.js'
import { runRecipe } from './recipes/run-recipe.js'
export class Runner {
  config
  #registry
  constructor(config) {
    this.config = config
    this.#registry = new ProviderRegistry(config)
  }
  get registry() {
    return this.#registry
  }
  async run(r, args, options) {
    return runRecipe(this, r, args, options)
  }
}
