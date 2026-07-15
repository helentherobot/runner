import type { LanguageModel } from 'ai';
import { createOllama } from 'ollama-ai-provider';
import type { Provider } from './types.js';
export declare class OllamaProvider implements Provider {
    #private;
    constructor(baseURL?: string, deps?: {
        client?: ReturnType<typeof createOllama>;
    });
    model(key: string): LanguageModel;
}
//# sourceMappingURL=ollama.d.ts.map