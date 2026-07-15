import { createGoogleGenerativeAI } from '@ai-sdk/google';
export class GoogleProvider {
    #client;
    constructor(apiKey, deps) {
        this.#client = deps?.client ?? createGoogleGenerativeAI({ apiKey });
    }
    model(key) {
        return this.#client(key);
    }
}
