import { generateText } from 'ai'
import type { RunnerConfig } from '../types.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { Recipe, RunResult, RunOptions } from './types.js'
import { RequestCancelledError, ProviderUnavailableError } from '../errors.js'

export interface RunnerInstance {
  config: RunnerConfig
  registry: ProviderRegistry
}

export async function runRecipe<TArgs extends unknown[]>(
  runner: RunnerInstance,
  r: Recipe<TArgs>,
  args: TArgs,
  options?: RunOptions,
): Promise<RunResult> {
  const profile = runner.config.profiles[r.profile]

  if (!profile) {
    throw new Error(`Unknown profile: ${r.profile}`)
  }

  const secrets = runner.config.secrets ?? {}
  const provider = runner.registry.getProvider(profile.provider, secrets)
  const model = provider.model(profile.model)
  const queue = runner.registry.getQueue(r.profile, profile)

  if (profile.isAvailable && !(await profile.isAvailable())) {
    throw new ProviderUnavailableError(`Profile "${r.profile}" is not available`)
  }

  const prompt = r.prompt(...args)
  const maxOutputTokens = r.maxOutputTokens ?? profile.contextWindowTokens

  const timeoutSignal = profile.requestTimeoutMs
    ? AbortSignal.timeout(profile.requestTimeoutMs)
    : undefined

  const signals = [timeoutSignal, options?.abortSignal].filter((s): s is AbortSignal => !!s)
  const abortSignal = signals.length > 0 ? AbortSignal.any(signals) : undefined

  try {
    const result = await queue.enqueue(options?.scope ?? r.profile, () =>
      generateText({
        model,
        prompt,
        maxOutputTokens,
        maxRetries: profile.maxRetries ?? 3,
        abortSignal,
      }),
    )

    const inputTokens = result.usage.inputTokens ?? 0
    const outputTokens = result.usage.outputTokens ?? 0

    const totalCostUsd = profile.costs
      ? (inputTokens / 1_000_000) * profile.costs.inputPer1M +
        (outputTokens / 1_000_000) * profile.costs.outputPer1M
      : undefined

    return {
      text: result.text,
      usage: {
        inputTokens,
        outputTokens,
        totalCostUsd,
      },
    }
  } catch (err) {
    if (options?.abortSignal?.aborted) throw new RequestCancelledError()
    throw err
  }
}
