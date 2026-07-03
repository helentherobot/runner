import { generateText } from 'ai';
import { RequestCancelledError, ProviderUnavailableError } from '../errors.js';
export async function runRecipe(runner, r, args, options) {
    const resolved = runner.config.profiles[r.profile];
    if (!resolved) {
        throw new Error(`Unknown profile: ${r.profile}`);
    }
    if ('kind' in resolved && resolved.kind === 'composite') {
        let lastError;
        for (const candidateKey of resolved.candidates) {
            const candidate = runner.config.profiles[candidateKey];
            if (!candidate) {
                throw new Error(`Unknown profile: ${candidateKey}`);
            }
            if ('kind' in candidate && candidate.kind === 'composite') {
                throw new Error(`Nested composite profiles are not allowed: "${candidateKey}" is composite`);
            }
            try {
                return await runRecipe(runner, { ...r, profile: candidateKey }, args, options);
            }
            catch (err) {
                lastError = err;
            }
        }
        throw lastError;
    }
    const profile = resolved;
    const secrets = runner.config.secrets ?? {};
    const provider = runner.registry.getProvider(profile.provider, secrets);
    const model = provider.model(profile.model);
    const queue = runner.registry.getQueue(r.profile, profile);
    if (profile.isAvailable && !(await profile.isAvailable())) {
        throw new ProviderUnavailableError(`Profile "${r.profile}" is not available`);
    }
    const prompt = r.prompt(...args);
    const maxOutputTokens = r.maxOutputTokens ?? profile.contextWindowTokens;
    const timeoutSignal = profile.requestTimeoutMs
        ? AbortSignal.timeout(profile.requestTimeoutMs)
        : undefined;
    const signals = [timeoutSignal, options?.abortSignal].filter((s) => !!s);
    const abortSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined;
    try {
        const result = await queue.enqueue(options?.scope ?? r.profile, () => generateText({
            model,
            prompt,
            maxOutputTokens,
            maxRetries: profile.maxRetries ?? 3,
            abortSignal,
            providerOptions: profile.providerOptions,
        }));
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
    catch (err) {
        if (options?.abortSignal?.aborted)
            throw new RequestCancelledError();
        throw err;
    }
}
