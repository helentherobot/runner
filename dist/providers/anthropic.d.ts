import type { LanguageModel } from 'ai';
import { createAnthropic } from '@ai-sdk/anthropic';
import type { Provider } from './types.js';
export declare class AnthropicProvider implements Provider {
    #private;
    constructor(apiKey: string, deps?: {
        client?: ReturnType<typeof createAnthropic>;
    });
    model(key: string): LanguageModel;
}
//# sourceMappingURL=anthropic.d.ts.map