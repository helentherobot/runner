import type { QueueConfig } from '../types.js';
export declare class ProviderQueue {
    #private;
    constructor(config: QueueConfig, warmupFn?: () => Promise<void>);
    enqueue<T>(scope: string, fn: () => Promise<T>): Promise<T>;
}
//# sourceMappingURL=queue.d.ts.map