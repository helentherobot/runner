import type { LanguageModel } from 'ai';
import { createOpenRouter } from '@openrouter/ai-sdk-provider';
import type { Provider } from './types.js';
export declare class OpenRouterProvider implements Provider {
    #private;
    constructor(apiKey: string, deps?: {
        client?: ReturnType<typeof createOpenRouter>;
    });
    model(key: string): LanguageModel;
}
//# sourceMappingURL=open-router.d.ts.map