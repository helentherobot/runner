import type { RunnerConfig } from './types.js';
import type { Recipe, RunResult, RunOptions } from './recipes/types.js';
import { ProviderRegistry } from './providers/registry.js';
export declare class Runner {
    #private;
    readonly config: RunnerConfig;
    constructor(config: RunnerConfig);
    get registry(): ProviderRegistry;
    run<TArgs extends unknown[]>(r: Recipe<TArgs>, args: TArgs, options?: RunOptions): Promise<RunResult>;
}
//# sourceMappingURL=runner.d.ts.map