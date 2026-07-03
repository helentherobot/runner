import type { LanguageModel } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import type { Provider } from './types.js';
export declare class OpenAIProvider implements Provider {
    #private;
    constructor(apiKey: string, deps?: {
        client?: ReturnType<typeof createOpenAI>;
    });
    model(key: string): LanguageModel;
}
//# sourceMappingURL=openai.d.ts.map