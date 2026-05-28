import { generateText } from 'ai'
import type { CoreMessage, Tool, ToolSet } from 'ai'
import type { RunnerInstance } from '../recipes/run-recipe.js'
import type { SessionOptions, SendResult } from './types.js'
import { discoverTools } from './discover-tools.js'

export async function send(
  runner: RunnerInstance,
  options: SessionOptions,
  messages: CoreMessage[],
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

  const updatedMessages: CoreMessage[] = [...messages, { role: 'user', content: message }]

  const result = await queue.enqueue(options.profile, () =>
    generateText({
      model,
      system: options.systemPrompt,
      messages: updatedMessages,
      tools: toolSet,
      maxTokens: profile.contextWindowTokens,
    }),
  )

  updatedMessages.push({ role: 'assistant', content: result.text })

  const inputTokens = result.usage.promptTokens
  const outputTokens = result.usage.completionTokens

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
