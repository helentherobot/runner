import { createOpenAI } from '@ai-sdk/openai';
export class DeepSeekProvider {
    #client;
    constructor(apiKey, deps) {
        this.#client =
            deps?.client ??
                createOpenAI({
                    apiKey,
                    baseURL: 'https://api.deepseek.com',
                });
    }
    model(key) {
        // DeepSeek uses the /chat/completions endpoint; .chat() avoids the /responses route
        return this.#client.chat(key);
    }
}
