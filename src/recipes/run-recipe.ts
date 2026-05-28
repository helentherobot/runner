import { generateText } from 'ai'
import type { RunnerConfig } from '../types.js'
import type { ProviderRegistry } from '../providers/registry.js'
import type { Recipe, RunResult } from './types.js'

export interface RunnerInstance {
  config: RunnerConfig
  registry: ProviderRegistry
}

export async function runRecipe<TArgs extends unknown[]>(
  runner: RunnerInstance,
  r: Recipe<TArgs>,
  args: TArgs,
): Promise<RunResult> {
  const profile = runner.config.profiles[r.profile]

  if (!profile) {
    throw new Error(`Unknown profile: ${r.profile}`)
  }

  const secrets = runner.config.secrets ?? {}
  const provider = runner.registry.getProvider(profile.provider, secrets)
  const model = provider.model(profile.model)
  const queue = runner.registry.getQueue(r.profile, profile)

  const prompt = r.prompt(...args)
  const maxTokens = r.maxOutputTokens ?? profile.contextWindowTokens

  const result = await queue.enqueue(r.profile, () => generateText({ model, prompt, maxTokens }))

  const inputTokens = result.usage.promptTokens
  const outputTokens = result.usage.completionTokens

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
}
