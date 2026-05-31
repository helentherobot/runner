import { generateText } from 'ai'
import type { ModelMessage, StepResult, Tool, ToolSet } from 'ai'
import type { RunnerInstance } from '../recipes/run-recipe.js'
import type { SessionOptions, SendResult } from './types.js'
import { discoverTools } from './discover-tools.js'
import { RequestTimeoutError, RequestCancelledError } from '../errors.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function send(
  runner: RunnerInstance,
  options: SessionOptions,
  messages: (ModelMessage | string)[],
): Promise<SendResult> {
  const profile = runner.config.profiles[options.profile]

  if (!profile) {
    throw new Error(`Unknown profile: ${options.profile}`)
  }

  const secrets = runner.config.secrets ?? {}
  const provider = runner.registry.getProvider(profile.provider, secrets)
  const model = provider.model(profile.model)
  const queue = runner.registry.getQueue(options.profile, profile)

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
          abortSignal: mergedSignal,
          prepareStep: async (ctx) => {
            const base = options.prepareStep ? ((await options.prepareStep!(ctx)) ?? {}) : {}
            if (typeof options.tools !== 'function') return base
            return { ...base, tools: buildToolSet(ctx.messages as ModelMessage[]) }
          },
          stopWhen: options.stopWhen,
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

  updatedMessages.push({ role: 'assistant', content: result.text })

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
