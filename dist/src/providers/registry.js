import { generateText } from 'ai';
import { ProviderQueue } from './queue.js';
import { OpenRouterProvider } from './open-router.js';
import { GoogleProvider } from './google.js';
import { OpenAIProvider } from './openai.js';
import { AnthropicProvider } from './anthropic.js';
import { OllamaProvider } from './ollama.js';
export class ProviderRegistry {
    #config;
    #providers = new Map();
    #queues = new Map();
    constructor(config) {
        this.#config = config;
    }
    getProvider(key, secrets) {
        if (this.#providers.has(key)) {
            return this.#providers.get(key);
        }
        const provider = this.#createProvider(key, secrets);
        this.#providers.set(key, provider);
        return provider;
    }
    #createProvider(key, secrets) {
        switch (key) {
            case 'open-router':
                return new OpenRouterProvider(secrets.openRouter ?? '');
            case 'google':
                return new GoogleProvider(secrets.google ?? '');
            case 'openai':
                return new OpenAIProvider(secrets.openAi ?? '');
            case 'anthropic':
                return new AnthropicProvider(secrets.anthropic ?? '');
            case 'ollama':
                return new OllamaProvider();
            default:
                throw new Error(`Unknown provider key: ${key}`);
        }
    }
    getQueue(profileKey, profile) {
        if (this.#queues.has(profileKey)) {
            return this.#queues.get(profileKey);
        }
        let warmupFn;
        if (profile.queue.warmup) {
            const secrets = this.#config.secrets ?? {};
            const provider = this.getProvider(profile.provider, secrets);
            const model = provider.model(profile.model);
            warmupFn = async () => {
                await generateText({ model, prompt: 'hi', maxOutputTokens: 1 });
            };
        }
        const queue = new ProviderQueue(profile.queue, warmupFn);
        this.#queues.set(profileKey, queue);
        return queue;
    }
}
