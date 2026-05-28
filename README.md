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

`send()` is a standalone function (not a method) that advances a conversation by one turn. The caller owns the `messages` array — helen-runner holds no inter-call state.

```ts
import { send } from '@helentherobot/runner'
import type { ModelMessage, SessionOptions } from '@helentherobot/runner'

const controller = new AbortController()

const options: SessionOptions = {
  profile: 'flash',
  systemPrompt: 'You are a helpful assistant.',
  scope: 'user-123', // optional — used for affinity-mode prioritisation
  abortSignal: controller.signal, // optional — cancels the in-flight call immediately
}

let messages: ModelMessage[] = []

// first turn
messages = (await send(runner, options, messages, 'What is the capital of France?')).messages

// second turn
messages = (await send(runner, options, messages, 'What language do they speak there?')).messages
```

Each call appends a `{ role: 'user' }` entry, calls the model, then appends the `{ role: 'assistant' }` response. Pass `result.messages` into the next call to carry the full history forward.

`send()` applies `requestTimeoutMs` from the profile as a **per-step** timeout — the clock resets after each LLM step, so multi-step tool-call flows are not punished. On timeout the message state is rolled back to the pre-call snapshot and the call is retried up to `maxRetries` times with a ~1s backoff.

### Timeout and cancellation errors

Both `send()` and `runner.run()` throw typed errors so callers can handle each failure mode explicitly:

```ts
import { send, RequestTimeoutError, RequestCancelledError } from '@helentherobot/runner'

try {
  messages = (await send(runner, options, messages, userMessage)).messages
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

This lets you register a large set of tools up front and have them revealed to the model only when the conversation has reached a point where they are relevant.

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

Tools with no `keywords` field (or `keywords: () => []`) are always included.

### ProviderQueue

Each model profile gets its own `ProviderQueue` (created lazily by the registry). The queue enforces:

- **`maxConcurrent`** — at most this many in-flight requests at once
- **`requestsPerMinute`** — sliding-window rate cap; excess calls are held and dispatched automatically once the window clears
- **`affinityMode`** — when `true`, pending calls whose `scope` matches the currently active scope are prioritised over other scopes
- **`warmup`** — when `true`, the queue fires a trivial one-token `generateText` call before the first real request (useful for providers that have cold-start latency)

### Supported providers

| Key           | Package                                                                 |
| ------------- | ----------------------------------------------------------------------- |
| `open-router` | `@openrouter/ai-sdk-provider`                                           |
| `google`      | `@ai-sdk/google`                                                        |
| `openai`      | `@ai-sdk/openai`                                                        |
| `anthropic`   | `@ai-sdk/anthropic`                                                     |
| `ollama`      | `ollama-ai-provider` (no API key; defaults to `http://localhost:11434`) |

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
