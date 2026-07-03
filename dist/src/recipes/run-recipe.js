import { generateText } from 'ai';
export async function runRecipe(runner, r, args, scope) {
    const profile = runner.config.profiles[r.profile];
    if (!profile) {
        throw new Error(`Unknown profile: ${r.profile}`);
    }
    const secrets = runner.config.secrets ?? {};
    const provider = runner.registry.getProvider(profile.provider, secrets);
    const model = provider.model(profile.model);
    const queue = runner.registry.getQueue(r.profile, profile);
    const prompt = r.prompt(...args);
    const maxOutputTokens = r.maxOutputTokens ?? profile.contextWindowTokens;
    const result = await queue.enqueue(scope ?? r.profile, () => generateText({ model, prompt, maxOutputTokens }));
    const inputTokens = result.usage.inputTokens ?? 0;
    const outputTokens = result.usage.outputTokens ?? 0;
    const totalCostUsd = profile.costs
        ? (inputTokens / 1_000_000) * profile.costs.inputPer1M +
            (outputTokens / 1_000_000) * profile.costs.outputPer1M
        : undefined;
    return {
        text: result.text,
        usage: {
            inputTokens,
            outputTokens,
            totalCostUsd,
        },
    };
}
