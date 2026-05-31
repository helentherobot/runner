# Runner

[![npm](https://img.shields.io/npm/v/@helentherobot/runner)](https://www.npmjs.com/package/@helentherobot/runner)

A thin, opinionated wrapper around the [Vercel AI SDK](https://sdk.vercel.ai/) that handles model profiles, per-profile queue management, multi-turn session execution, and timeout/cancellation.

Runner has no opinion about working directories, databases, Telegram, users, or application-specific tooling. It is the base layer everything else builds on.

## Installation

```sh
npm install @helentherobot/runner
```

## Concepts

### Runner

The entry point. Construct one with a `RunnerConfig` describing your named model profiles and API keys. The `Runner` owns a `ProviderRegistry` internally — providers and queues are created lazily and cached for the lifetime of the instance.

```ts
import { Runner } from '@helentherobot/runner'

const runner = new Runner({
  profiles: {
    flash: {
      provider: 'google',
      model: 'gemini-2.0-flash',
      contextWindowTokens: 128_000,
      requestTimeoutMs: 30_000, // per-step timeout for send(); single-step timeout for run()
      maxRetries: 3, // optional, defaults to 3 at the call site
      queue: {
        maxConcurrent: 4,
        requestsPerMinute: 60,
        affinityMode: false,
        warmup: false,
      },
      costs: {
        inputPer1M: 0.1,
        outputPer1M: 0.4,
      },
    },
  },
  secrets: {
    google: process.env.GOOGLE_API_KEY,
  },
})
```

### Recipes — single-turn stateless calls

A `Recipe<TArgs>` describes a single-turn prompt: which profile to use, a prompt factory function, and an optional token cap. The `recipe()` helper is just a thin wrapper for TypeScript inference.

```ts
import { recipe } from '@helentherobot/runner'

const summarise = recipe({
  profile: 'flash',
  prompt: (text: string) => `Summarise the following in one sentence: ${text}`,
  maxOutputTokens: 256,
})

const result = await runner.run(summarise, [articleText])
console.log(result.text)
console.log(result.usage) // { inputTokens, outputTokens, totalCostUsd }

// Optional: pass a scope string for affinity-mode prioritisation
const result2 = await runner.run(summarise, [articleText], { scope: 'session-abc' })

// Optional: pass an AbortSignal for external cancellation
const controller = new AbortController()
const result3 = await runner.run(summarise, [articleText], { abortSignal: controller.signal })

// Both together
const result4 = await runner.run(summarise, [articleText], {
  scope: 'session-abc',
  abortSignal: controller.signal,
})
```

`runner.run()` enqueues the call through the profile's `ProviderQueue`, so concurrency and rate limits are enforced automatically. `requestTimeoutMs` from the profile is applied as a hard timeout for each call; if the call times out it is retried up to `maxRetries` times before throwing.

### Sessions — multi-turn conversations

> **Breaking change in 0.3.0**: the fourth `message: string` parameter has been removed. Pass all messages — including the new user turn — in the `messages` array instead.
>
> ```ts
> // before (0.2.x)
> send(runner, options, history, 'new user message')
>
> // after (0.3.0)
> send(runner, options, [...history, 'new user message'])
> ```
>
> Plain strings in the array are coerced to `{ role: 'user', content: string }` automatically.

`send()` is a standalone function (not a method) that advances a conversation by one turn. The caller owns the `messages` array — helen-runner holds no inter-call state.

```ts
import { send } from '@helentherobot/runner'
import type { CoreMessage, SessionOptions } from '@helentherobot/runner'

const controller = new AbortController()

const options: SessionOptions = {
  profile: 'flash',
  systemPrompt: 'You are a helpful assistant.',
  scope: 'user-123', // optional — used for affinity-mode prioritisation
  abortSignal: controller.signal, // optional — cancels the in-flight call immediately
}

let messages: CoreMessage[] = []

// first turn
messages = (await send(runner, options, [...messages, 'What is the capital of France?'])).messages

// second turn
messages = (await send(runner, options, [...messages, 'What language do they speak there?']))
  .messages
```

Each call coerces any string entries to `{ role: 'user' }`, calls the model, then appends the `{ role: 'assistant' }` response. Pass `result.messages` into the next call to carry the full history forward.

`send()` applies `requestTimeoutMs` from the profile as a **per-step** timeout — the clock resets after each LLM step, so multi-step tool-call flows are not punished. On timeout the message state is rolled back to the pre-call snapshot and the call is retried up to `maxRetries` times with a ~1s backoff.

#### Step lifecycle hooks

Use `prepareStep` to inspect or rewrite the message list before each model invocation — for example, to compact the context window when token usage is high:

```ts
import type { SessionOptions, StepResult } from '@helentherobot/runner'

const options: SessionOptions = {
  profile: 'flash',
  prepareStep: async ({ messages, steps }) => {
    const lastStep = steps.at(-1)
    if (lastStep && lastStep.usage.promptTokens > 80_000) {
      // trim old messages to stay within the context window
      return { messages: messages.slice(-20) }
    }
    // returning void leaves the message list unchanged
  },
}
```

`prepareStep` receives `{ messages: CoreMessage[], steps: StepResult[] }`. Return `{ messages }` to replace the list for the next step, or return `void` to leave it as-is.

Use `onStepFinish` to observe each step result without re-implementing the loop:

```ts
const options: SessionOptions = {
  profile: 'flash',
  onStepFinish: (step) => {
    console.log('step tokens:', step.usage.promptTokens, '+', step.usage.completionTokens)
  },
}
```

`onStepFinish` receives the full `StepResult`. The internal timeout-reset logic always fires first, so a throwing callback does not prevent the timer from being reset.

#### Controlled stopping

Pass `stopWhen` to cap the number of steps or define a custom stop condition:

```ts
import { stepCountIs } from 'ai'

const options: SessionOptions = {
  profile: 'flash',
  stopWhen: stepCountIs(10),
}
```

`stopWhen` is forwarded to `generateText` as-is. It accepts a single `StopCondition` or an array.

#### Provider options

`providerOptions` set on a `ModelProfile` is automatically threaded through to every `generateText` call made with that profile. No per-call override is needed — configure it once on the profile.

#### Retry control

By default, only timeout errors are retried. Use `isRetryable` to extend retry behaviour to other errors — for example, HTTP 429 rate-limit responses:

```ts
const options: SessionOptions = {
  profile: 'flash',
  isRetryable: (error) => (error as { status?: number }).status === 429,
  onRetry: (attempt, maxAttempts, reason) => {
    console.log(`retry ${attempt}/${maxAttempts} — reason: ${reason}`)
  },
  backoffMs: (attempt, reason) => (reason === 'timeout' ? 1000 : attempt * 2000),
}
```

- `isRetryable(error): boolean` — consulted for non-timeout errors only. Timeout errors are always retried without calling this.
- `onRetry(attempt, maxAttempts, reason)` — called before each retry, after deciding to retry but before rollback and sleep. `reason` is `'timeout'` or the error's `.name`.
- `backoffMs(attempt, reason): number` — return the number of milliseconds to sleep before the next attempt. Defaults to `1000` if not provided.

#### Tool timeout

Tool execution can take far longer than model inference. Use `toolTimeoutMs` to give tool calls a wider abort window:

```ts
const options: SessionOptions = {
  profile: 'flash',
  toolTimeoutMs: 60_000, // 60 s for tool execution
  // requestTimeoutMs from the profile applies to model inference steps
}
```

When a step finishes with pending tool calls, the abort timer is reset with `toolTimeoutMs` instead of `requestTimeoutMs`. The timer reverts to `requestTimeoutMs` for the next model step. If `toolTimeoutMs` is not set, `requestTimeoutMs` is used for all phases.

### Timeout and cancellation errors

Both `send()` and `runner.run()` throw typed errors so callers can handle each failure mode explicitly:

```ts
import { send, RequestTimeoutError, RequestCancelledError } from '@helentherobot/runner'

try {
  messages = (await send(runner, options, [...messages, userMessage])).messages
} catch (err) {
  if (err instanceof RequestTimeoutError) {
    // timed out and exhausted all retries — e.g. surface a "try again" message
    console.error(err.message) // "Request timed out after 3 retries"
  } else if (err instanceof RequestCancelledError) {
    // the AbortSignal passed in options was aborted by the caller
    console.error('Request was cancelled')
  } else {
    throw err
  }
}
```

| Error                   | When thrown                                                      |
| ----------------------- | ---------------------------------------------------------------- |
| `RequestTimeoutError`   | `requestTimeoutMs` fired and all retries were exhausted          |
| `RequestCancelledError` | The caller's `abortSignal` was aborted before the call completed |

### Tools and progressive discovery

Tools are defined as `DiscoverableTool`, which extends the Vercel AI SDK's `Tool` type with two extra fields:

- `name: string` — used to key the tool in the call to `generateText`
- `keywords?(): string[]` — optional. When provided, the tool is only included in the active tool set if one of its keywords appears anywhere in the conversation history (user or assistant)

By default, progressive discovery is **on**: tools are withheld from the model and revealed only when their keywords appear in the conversation. This keeps the tool list lean for models that get confused by large tool sets.

```ts
import { zodSchema } from 'ai'
import type { DiscoverableTool } from '@helentherobot/runner'
import { z } from 'zod'

const searchTool: DiscoverableTool = {
  name: 'search',
  description: 'Search the web for current information.',
  inputSchema: zodSchema(z.object({ query: z.string() })),
  execute: async ({ query }) => {
    /* ... */
  },
  keywords: () => ['search', 'look up', 'find'],
}

const options: SessionOptions = {
  profile: 'flash',
  tools: [searchTool],
}
```

#### Disabling progressive discovery

For capable models, progressive discovery can hurt prompt caching — the effective system prompt changes every turn as new tools are unlocked. Set `progressiveToolDiscovery: false` to pass all tools on every turn and keep the system prompt stable:

```ts
const options: SessionOptions = {
  profile: 'flash',
  tools: [searchTool],
  progressiveToolDiscovery: false, // all tools passed on every turn
}
```

You can also set it on a `ModelProfile` so it applies automatically to every session using that profile — no per-call override needed:

```ts
const runner = new Runner({
  profiles: {
    sonnet: {
      provider: 'anthropic',
      model: 'claude-sonnet-4-6',
      progressiveToolDiscovery: false, // disable for all sessions on this profile
      // ...
    },
  },
  secrets: { anthropic: process.env.ANTHROPIC_API_KEY },
})
```

`SessionOptions.progressiveToolDiscovery` overrides the profile value if both are set. Tools with no `keywords` field are always included regardless of the toggle.

#### Dynamic tool sets

`tools` also accepts a closure, which is re-evaluated before each model step. This is useful when the available tool set may change mid-turn — for example, when a tool fires and narrows the active set for subsequent steps:

```ts
const options: SessionOptions = {
  profile: 'flash',
  tools: () => getCurrentTools(), // re-evaluated before each model step
}
```

### ProviderQueue

Each model profile gets its own `ProviderQueue` (created lazily by the registry). The queue enforces:

- **`maxConcurrent`** — at most this many in-flight requests at once
- **`requestsPerMinute`** — sliding-window rate cap; excess calls are held and dispatched automatically once the window clears
- **`affinityMode`** — when `true`, pending calls whose `scope` matches the currently active scope are prioritised over other scopes
- **`warmup`** — when `true`, the queue fires a trivial one-token `generateText` call before the first real request (useful for providers that have cold-start latency)

### Supported providers

| Key           | Package                        | Notes                                                     |
| ------------- | ------------------------------ | --------------------------------------------------------- |
| `open-router` | `@openrouter/ai-sdk-provider`  |                                                           |
| `google`      | `@ai-sdk/google`               |                                                           |
| `openai`      | `@ai-sdk/openai`               |                                                           |
| `anthropic`   | `@ai-sdk/anthropic`            |                                                           |
| `deepseek`    | `@ai-sdk/openai`               | Uses `https://api.deepseek.com`; requires `deepSeek` key  |
| `lm-studio`   | `@ai-sdk/openai`               | Local inference; defaults to `http://localhost:1234/v1`   |
| `ollama`      | `ollama-ai-provider`           | No API key; defaults to `http://localhost:11434`          |

Provider secrets are passed in `RunnerConfig.secrets`:

```ts
secrets: {
  openRouter: process.env.OPENROUTER_API_KEY,
  google: process.env.GOOGLE_API_KEY,
  openAi: process.env.OPENAI_API_KEY,
  anthropic: process.env.ANTHROPIC_API_KEY,
  deepSeek: process.env.DEEPSEEK_API_KEY,
  lmStudioBaseUrl: process.env.LM_STUDIO_BASE_URL, // optional; overrides the default base URL
}
```

helen-runner never reads `process.env` directly — how you populate `secrets` is entirely your concern.

## Design notes

**No streaming.** Only `generateText` from the Vercel AI SDK. `streamText` is out of scope.

**`send()` is pure.** It takes messages in and returns `{ messages, usage }` out. Nothing is stored between calls. The runner itself holds no conversation state. On timeout-triggered retries, `send()` rolls the message array back to the pre-call snapshot before re-trying, so the caller always receives a consistent view.

**Registry is scoped to the `Runner` instance.** Providers and queues are not module-level singletons. Each `new Runner(config)` gets a clean registry, which avoids cross-test contamination and makes multiple runners with different configs straightforward.

**Secrets stay in config.** `RunnerConfig.secrets` is where API keys live. helen-runner never reads `process.env` directly. How you populate the secrets object — env vars, a secrets manager, test fixtures — is entirely your concern.

## Development

```sh
npm test            # run unit tests
npm run test:watch  # watch mode
npm run check       # typecheck + format check + tests in parallel
npm run format      # format all files with Prettier
```

Smoke tests require a local `.env` file with real API keys and are excluded from the main test run:

```sh
npm run test:smoke
```
