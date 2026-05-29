import { generateText } from 'ai'
import type { ModelMessage, Tool, ToolSet } from 'ai'
import type { RunnerInstance } from '../recipes/run-recipe.js'
import type { SessionOptions, SendResult } from './types.js'
import { discoverTools } from './discover-tools.js'
import { RequestTimeoutError, RequestCancelledError } from '../errors.js'

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms))

export async function send(
  runner: RunnerInstance,
  options: SessionOptions,
  messages: ModelMessage[],
  message: string,
): Promise<SendResult> {
  const profile = runner.config.profiles[options.profile]

  if (!profile) {
    throw new Error(`Unknown profile: ${options.profile}`)
  }

  const secrets = runner.config.secrets ?? {}
  const provider = runner.registry.getProvider(profile.provider, secrets)
  const model = provider.model(profile.model)
  const queue = runner.registry.getQueue(options.profile, profile)

  const activeTools = discoverTools(messages, options.tools ?? [])

  const toolSet: ToolSet | undefined =
    activeTools.length > 0
      ? Object.fromEntries(
          activeTools.map(({ name, keywords: _keywords, ...rest }) => [name, rest as Tool]),
        )
      : undefined

  const updatedMessages: ModelMessage[] = [...messages, { role: 'user', content: message }]
  const snapshot = [...updatedMessages]

  const maxRetries = profile.maxRetries ?? 3

  const result = await queue.enqueue(options.scope ?? options.profile, async () => {
    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      const controller = new AbortController()
      let timeoutId: ReturnType<typeof setTimeout> | null = null

      const resetTimeout = () => {
        if (timeoutId) clearTimeout(timeoutId)
        if (profile.requestTimeoutMs) {
          timeoutId = setTimeout(
            () => controller.abort('request-timeout'),
            profile.requestTimeoutMs,
          )
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
          tools: toolSet,
          maxRetries: 0,
          abortSignal: mergedSignal,
          onStepFinish: () => resetTimeout(),
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

        if (isTimeout && attempt < maxRetries) {
          updatedMessages.length = 0
          updatedMessages.push(...snapshot)
          await sleep(1000)
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
