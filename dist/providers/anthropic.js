import { createAnthropic } from '@ai-sdk/anthropic';
export class AnthropicProvider {
    #client;
    constructor(apiKey, deps) {
        this.#client = deps?.client ?? createAnthropic({ apiKey });
    }
    model(key) {
        return this.#client(key);
    }
}
