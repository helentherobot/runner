import { generateText, stepCountIs } from 'ai'
import type { ModelMessage, StepResult, Tool, ToolSet } from 'ai'
import type { RunnerInstance } from '../recipes/run-recipe.js'
import type { SessionOptions, SendResult } from './types.js'
import type { ModelProfile } from '../types.js'
import { discoverTools } from './discover-tools.js'
import { RequestTimeoutError, RequestCancelledError, ProviderUnavailableError } from '../errors.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function send(
  runner: RunnerInstance,
  options: SessionOptions,
  messages: (ModelMessage | string)[],
): Promise<SendResult> {
  const resolved = runner.config.profiles[options.profile]

  if (!resolved) {
    throw new Error(`Unknown profile: ${options.profile}`)
  }

  if ('kind' in resolved && resolved.kind === 'composite') {
    let lastError: unknown
    for (const candidateKey of resolved.candidates) {
      const candidate = runner.config.profiles[candidateKey]
      if (!candidate) {
        throw new Error(`Unknown profile: ${candidateKey}`)
      }
      if ('kind' in candidate && candidate.kind === 'composite') {
        throw new Error(`Nested composite profiles are not allowed: "${candidateKey}" is composite`)
      }
      try {
        return await send(runner, { ...options, profile: candidateKey }, messages)
      } catch (err) {
        lastError = err
      }
    }
    throw lastError
  }

  const profile = resolved as ModelProfile

  const secrets = runner.config.secrets ?? {}
  const provider = runner.registry.getProvider(profile.provider, secrets)
  const model = provider.model(profile.model)
  const queue = runner.registry.getQueue(options.profile, profile)

  if (profile.isAvailable && !(await profile.isAvailable())) {
    throw new ProviderUnavailableError(`Profile "${options.profile}" is not available`)
  }

  const progressive = options.progressiveToolDiscovery ?? profile.progressiveToolDiscovery ?? true

  const buildToolSet = (msgs: ModelMessage[]): ToolSet | undefined => {
    const toolsArray = typeof options.tools === 'function' ? options.tools() : (options.tools ?? [])
    const activeTools = progressive ? discoverTools(msgs, toolsArray) : toolsArray
    return activeTools.length > 0
      ? Object.fromEntries(
          activeTools.map(({ name, keywords: _keywords, ...rest }) => [name, rest as Tool]),
        )
      : undefined
  }

  const updatedMessages: ModelMessage[] = messages.map((m) =>
    typeof m === 'string' ? { role: 'user', content: m } : m,
  )
  const snapshot = [...updatedMessages]

  const maxRetries = profile.maxRetries ?? 3

  // Resolve maxSteps: session-level overrides profile-level.
  // Only applied when stopWhen is not explicitly provided — explicit stop conditions win.
  const effectiveMaxSteps = options.maxSteps ?? profile.maxSteps
  const resolvedMaxSteps = effectiveMaxSteps != null ? stepCountIs(effectiveMaxSteps) : undefined

  // Resolve maxOutputTokens: session-level overrides profile-level.
  const resolvedMaxOutputTokens = options.maxOutputTokens ?? profile.maxOutputTokens

  const result = await queue.enqueue(options.scope ?? options.profile, async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const resetTimeout = (ms?: number) => {
        if (timeoutId) clearTimeout(timeoutId)
        const timeoutMs = ms ?? profile.requestTimeoutMs
        if (timeoutMs) {
          timeoutId = setTimeout(() => controller.abort('request-timeout'), timeoutMs)
        }
      }

      const mergedSignal = options.abortSignal
        ? AbortSignal.any([controller.signal, options.abortSignal])
        : controller.signal

      resetTimeout()

      try {
        const genResult = await generateText({
          model,
          system: options.systemPrompt,
          messages: updatedMessages,
          tools: buildToolSet(updatedMessages),
          maxRetries: 0,
          ...(resolvedMaxOutputTokens != null ? { maxOutputTokens: resolvedMaxOutputTokens } : {}),
          abortSignal: mergedSignal,
          prepareStep: async (ctx) => {
            const base = options.prepareStep ? ((await options.prepareStep!(ctx)) ?? {}) : {}
            if (typeof options.tools !== 'function') return base
            return { ...base, tools: buildToolSet(ctx.messages as ModelMessage[]) }
          },
          stopWhen: options.stopWhen ?? resolvedMaxSteps,
          providerOptions: profile.providerOptions,
          onStepFinish: async (step: StepResult<ToolSet>) => {
            const timeoutMs =
              step.toolCalls.length > 0 && options.toolTimeoutMs != null
                ? options.toolTimeoutMs
                : profile.requestTimeoutMs
            resetTimeout(timeoutMs)
            await options.onStepFinish?.(step)
          },
        })

        if (timeoutId) clearTimeout(timeoutId)
        return genResult
      } catch (err) {
        if (timeoutId) clearTimeout(timeoutId)

        if (options.abortSignal?.aborted) {
          throw new RequestCancelledError()
        }

        const isTimeout =
          controller.signal.aborted && controller.signal.reason === 'request-timeout'

        const reason = isTimeout ? 'timeout' : ((err as Error)?.name ?? 'error')
        const willRetry = (isTimeout || options.isRetryable?.(err) === true) && attempt < maxRetries

        if (willRetry) {
          options.onRetry?.(attempt, maxRetries, reason)
          updatedMessages.length = 0
          updatedMessages.push(...snapshot)
          await sleep(options.backoffMs?.(attempt, reason) ?? 1000)
          continue
        }

        if (isTimeout) {
          throw new RequestTimeoutError(maxRetries)
        }

        throw err
      }
    }

    // unreachable, but satisfies TypeScript
    throw new RequestTimeoutError(maxRetries)
  })

  // Append the full response message chain — assistant turns, tool calls, and tool results.
  // result.response.messages is the cumulative set of all generated messages across every step,
  // not just the final text. Without this, looped tool-calling sessions lose the entire
  // tool interaction history and the model can't see what it called or what came back.
  updatedMessages.push(...result.response.messages)

  const inputTokens = result.usage.inputTokens ?? 0
  const outputTokens = result.usage.outputTokens ?? 0

  const totalCostUsd = profile.costs
    ? (inputTokens / 1_000_000) * profile.costs.inputPer1M +
      (outputTokens / 1_000_000) * profile.costs.outputPer1M
    : undefined

  return {
    messages: updatedMessages,
    usage: {
      inputTokens,
      outputTokens,
      totalCostUsd,
    },
  }
}
