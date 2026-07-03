import { createOpenRouter } from '@openrouter/ai-sdk-provider';
export class OpenRouterProvider {
    #client;
    constructor(apiKey, deps) {
        this.#client = deps?.client ?? createOpenRouter({ apiKey });
    }
    model(key) {
        return this.#client(key);
    }
}
