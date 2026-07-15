import type { LanguageModel } from 'ai';
import { createGoogleGenerativeAI } from '@ai-sdk/google';
import type { Provider } from './types.js';
export declare class GoogleProvider implements Provider {
    #private;
    constructor(apiKey: string, deps?: {
        client?: ReturnType<typeof createGoogleGenerativeAI>;
    });
    model(key: string): LanguageModel;
}
//# sourceMappingURL=google.d.ts.map