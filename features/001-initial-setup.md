# Initial Setup

- Branch: `feature/001-initial-setup`

## Overview

`helen-runner` is a new standalone library being extracted from the Helen AI agent framework. It is a thin, opinionated wrapper around the Vercel AI SDK that handles model profiles, per-profile queue management, and multi-turn session execution. Nothing in helen-runner knows about working directories, Telegram, users, personas, or application-specific tooling — it is the base layer everything else builds on.

Helen currently has its provider, queue, recipe, and session runner logic baked into the application. There is no clean extraction point: config coupling, SQLite-backed state, Telegram lifecycle hooks, and Helen-specific tool dispatch are all tangled together. Any consumer wanting to build a lightweight AI agent loop has to pull in all of Helen.

helen-runner solves this by providing a standalone, framework-agnostic library with a clean public API. Consumers instantiate a `Runner` with a profile config, execute stateless single-turn recipes via `runner.run()`, or create multi-turn session handles and call `send()` to advance them. History is owned by the caller — helen-runner holds no inter-call state.

### Background / Current Behavior

- **Current behavior**: All AI execution logic (providers, queues, recipes, session runner) lives inside Helen's application layer with deep coupling to config, SQLite, Telegram, and the ACP session lifecycle.
- **Problem**: There is no standalone entry point for "just run a prompt against a model with queue management." Extraction requires untangling Helen's full dependency graph.
- **Where it happens**: `helen.assertchris.dev/src/agent/`, `src/recipes/`, `src/acp/session.ts`
- **Impact**: Any new project wanting model execution has to either copy Helen wholesale or re-implement the provider/queue layer from scratch.

### Target Outcome

This feature will build the initial `helen-runner` repo so that consumers can:

- Define model profiles with queue settings and construct a `Runner` from config
- Execute single-turn stateless prompts via `runner.run(recipe, args)`
- Run multi-turn sessions with explicit messages ownership via `send()`
- Register tools with optional keyword-based discovery that reveals them only when relevant

## Requirements

### Functional

- [ ] `Runner` can be constructed with a `RunnerConfig` containing named `ModelProfile` entries
- [ ] `runner.run(recipe, args)` executes a single-turn prompt and returns the text response
- [ ] `send(runner, options, messages, message)` handles multi-turn execution; caller owns the `messages` array
- [ ] `send(session, messages, message)` is a pure function: takes messages in, returns `{ messages, usage }` out
- [ ] `DiscoverableTool` interface supports `keywords?()` for progressive tool discovery
- [ ] Tools without `keywords` (or returning `[]`) are always visible; tools with keywords only appear when those keywords are present in conversation messages
- [ ] `ProviderQueue` enforces per-profile `maxConcurrent` and `requestsPerMinute` limits
- [ ] `ProviderRegistry` lazily creates and caches one provider + one queue per profile
- [ ] Secrets (API keys) are passed via `RunnerConfig`, not read directly from `process.env`
- [ ] Supports providers: OpenRouter, Google, OpenAI, Anthropic, Ollama

### Non-Functional

- [ ] Observability: No mandatory logging; consumers may inject a logger via config
- [ ] Performance: `ProviderQueue` must not block the event loop; use promise-based concurrency
- [ ] Security/Permissions: API keys accepted in config only; never logged or exposed in errors
- [ ] Backwards compatibility: N/A — new library, no prior consumers
- [ ] No streaming: only `generateText` from Vercel AI SDK; no `streamText`

### Out of Scope

- npm publishing (plain git repo for now)
- Background task queue / SQLite-backed job queue
- Telegram integration, Telegram lifecycle hooks
- Working directory management or file system tools
- Persona / persona config system
- `enqueueRecipe()` / background task dispatch
- Session resumption across process restarts (no `persistSession` in Phase 1)
- Brave Search / any web search tooling (belongs in the consumer application layer)

## Implementation Plan

> **Code style**: No useless comments. Only add comments that explain tricky/non-obvious code.
> **Before committing**: Run `npm run format` and `npm test` before every commit.
> **No auto-committing**: Only commit when explicitly asked.
> **One step at a time**: Complete only the current step before proceeding.

---

### Phase 1: Project scaffold + core types

**Goal**: Get a working TypeScript + vitest project with all tooling configured, and define the foundational exported types.

#### Steps

1. **Initialise `package.json`**
   - `"type": "module"` (ESM throughout)
   - `"main": "./src/index.js"` and `"exports": { ".": "./src/index.js" }`
   - Scripts: `test`, `test:watch`, `check` (typecheck + format:check + test in parallel), `format`, `format:check`
   - Dependencies: `ai`, `@ai-sdk/google`, `@ai-sdk/openai`, `@ai-sdk/anthropic`, `@openrouter/ai-sdk-provider`, `ollama-ai-provider`
   - Dev dependencies: `typescript@6`, `tsx`, `vitest`, `@vitest/coverage-v8`, `prettier`, `@types/node`, `concurrently`

2. **Create `tsconfig.json`**
   - `target: ES2022`, `module: NodeNext`, `moduleResolution: NodeNext`
   - `strict: true`, `declaration: true`, `declarationMap: true`
   - `"ignoreDeprecations": "6.0"` (required for TypeScript 6)
   - Path aliases: `@/*` → `./src/*`
   - Include: `src/**/*`, `tests/**/*`

3. **Create `vitest.config.ts`**
   - Resolve `@/` alias to `./src/` so tests can use the same paths as source
   - Coverage provider: `v8`

4. **Create `.gitignore`** — `node_modules/`, `dist/`, `coverage/`, `.env`

5. **Copy GitHub Actions CI from Helen**
   - Copy `.github/workflows/` from `helen.assertchris.dev` (or the closest equivalent)
   - CI runs `npm run check` (typecheck + format + unit tests) on push/PR
   - Smoke tests are **not** included in CI — they require real API keys

6. **Add smoke test infrastructure**
   - Create `tests/smoke/` directory — one file per provider: `open-router.smoke.ts`, `google.smoke.ts`, `openai.smoke.ts`, `anthropic.smoke.ts`, `ollama.smoke.ts`
   - Smoke tests are excluded from the main vitest config (use a filename pattern like `*.smoke.ts` in `exclude`)
   - Add a separate `vitest.smoke.config.ts` that includes only `tests/smoke/**/*.smoke.ts`
   - Secrets come from a local `.env` file loaded via `--env-file .env` (Node 20+ built-in, no `dotenv` dep needed)
   - Add npm script: `"test:smoke": "vitest run --config vitest.smoke.config.ts"`
   - Each smoke test: construct a minimal `Runner` with the provider under test, run a trivial recipe (e.g. `prompt: 'Say hello'`), assert `result.text` is a non-empty string and `result.usage.inputTokens > 0`

7. **Define core types in `src/types.ts`**

   ```ts
   export interface QueueConfig {
     maxConcurrent: number
     requestsPerMinute: number
     affinityMode: boolean
     warmup: boolean
   }

   export interface ModelProfile {
     provider: string // 'open-router' | 'google' | 'openai' | 'anthropic' | 'ollama'
     model: string // provider-specific model key
     contextWindowTokens: number
     requestTimeoutMs: number
     queue: QueueConfig
     costs?: {
       inputPer1M: number
       outputPer1M: number
     }
     providerOptions?: Record<string, unknown>
   }

   export interface RunnerConfig {
     profiles: Record<string, ModelProfile>
     secrets?: {
       openRouter?: string
       google?: string
       openAi?: string
       anthropic?: string
     }
   }
   ```

8. **Write tests in `tests/types.test.ts`**
   - Verify `RunnerConfig` `satisfies` the type with a valid fixture
   - Verify TypeScript compile-time errors for invalid profile shapes (use `@ts-expect-error` guards)

---

### Phase 2: Provider abstraction + ProviderQueue

**Goal**: Define the `Provider` interface and implement `ProviderQueue` with concurrency limiting, rate limiting, affinity mode, and warmup.

#### Steps

1. **Define `Provider` interface in `src/providers/provider.ts`**

   ```ts
   import type { LanguageModel } from 'ai'

   export interface Provider {
     model(key: string): LanguageModel
   }
   ```

   This is a thin abstraction over the Vercel AI SDK's `LanguageModel`.

2. **Implement `ProviderQueue` in `src/providers/queue.ts`**
   - Constructor accepts `QueueConfig` + optional `warmupFn: () => Promise<void>`
   - Maintains an internal in-flight counter (no third-party dep needed unless `requestsPerMinute` is > 0)
   - `enqueue<T>(scope: string, fn: () => Promise<T>): Promise<T>` — public API
   - Concurrency: reject new calls (queue them) when `inFlight >= maxConcurrent`; dispatch on completion
   - Rate limiting: if `requestsPerMinute > 0`, implement a sliding window token bucket using `Date.now()` — one bucket per minute, no third-party dep required
   - Affinity mode: when `affinityMode: true`, calls with a matching `scope` get priority over calls with a different scope (maintain a priority queue by scope)
   - Warmup: if `warmup: true`, call `warmupFn()` before dispatching the first request (once only — track `#warmedUp: boolean`)
   - All queued calls are held as promises; no timers or polling

3. **Write tests in `tests/providers/queue.test.ts`**
   - Concurrency: verify at most `maxConcurrent` calls run simultaneously (use artificial delays)
   - Rate limiting: verify calls are staggered when `requestsPerMinute` is exceeded
   - Affinity mode: verify in-scope calls are prioritised over out-of-scope
   - Warmup: verify `warmupFn` is called exactly once before the first dispatch
   - No warmup: verify skip when `warmup: false`

---

### Phase 3: Provider implementations + ProviderRegistry + secrets wiring

**Goal**: Port all 5 provider implementations from `helen.assertchris.dev` and build the `ProviderRegistry` with lazy singleton management.

#### Steps

1. **Port/implement provider implementations** — adapt from `helen.assertchris.dev/src/agent/providers/` where applicable

   `src/providers/open-router.ts`:
   - Uses `@openrouter/ai-sdk-provider` → `createOpenRouter({ apiKey })`
   - `model(key)` → `client(key)` → `LanguageModel`

   `src/providers/google.ts`:
   - Uses `@ai-sdk/google` → `createGoogleGenerativeAI({ apiKey })`
   - `model(key)` → `client(key)` → `LanguageModel`

   `src/providers/openai.ts`:
   - Uses `@ai-sdk/openai` → `createOpenAI({ apiKey })`
   - `model(key)` → `client(key)` → `LanguageModel`

   `src/providers/anthropic.ts`:
   - Uses `@ai-sdk/anthropic` → `createAnthropic({ apiKey })`
   - `model(key)` → `client(key)` → `LanguageModel`

   `src/providers/ollama.ts`:
   - Uses `ollama-ai-provider` → `createOllama({ baseURL })`
   - No API key; `baseURL` defaults to `'http://localhost:11434'`
   - `model(key)` → `client(key)` → `LanguageModel`

   All implementations accept an optional injected SDK client for testability.

2. **Implement `ProviderRegistry` in `src/providers/registry.ts`**
   - Module-level (or Runner-scoped) singletons: `Map<string, Provider>` and `Map<string, ProviderQueue>`
   - `getProvider(key: string, secrets: ResolvedSecrets): Provider`
     - Lazily instantiates the correct provider class on first call
     - Passes the relevant API key from `secrets`
     - Returns `undefined` (or throws) for unknown keys
   - `getQueue(profileKey: string): ProviderQueue`
     - Lazily instantiates one `ProviderQueue` per profile key
     - Looks up `QueueConfig` from `config.profiles[profileKey]` (registry has full config from construction)
     - Passes `QueueConfig` and warmup function if `warmup: true`
     - Warmup function: calls the provider's model with a trivial `generateText` call (`prompt: 'hi', maxOutputTokens: 1`)
   - Note: in helen-runner the registry is scoped to the `Runner` instance, not a module-level singleton (unlike Helen's original design) — this avoids cross-test contamination

3. **Write tests in `tests/providers/registry.test.ts`**
   - Verify singleton: same `Provider` instance returned on repeated `getProvider()` calls with same key
   - Verify singleton: same `ProviderQueue` returned on repeated `getQueue()` calls with same profile key
   - Verify unknown provider key throws (or returns undefined, document the contract)
   - Verify secrets are correctly passed to provider constructors (mock the SDK clients)

4. **Write tests in `tests/providers/*.test.ts`**
   - One test file per provider
   - Inject a mock SDK client; verify `model(key)` returns the expected value

---

### Phase 4: Recipe system (single-turn)

**Goal**: Implement the stateless single-turn recipe execution API: `Recipe<TArgs>`, `recipe()` factory, and `runner.run()`.

#### Steps

1. **Define `Recipe<TArgs>` in `src/recipes/types.ts`**

   ```ts
   export interface Recipe<TArgs extends unknown[] = unknown[]> {
     profile: string // key into RunnerConfig.profiles
     prompt: (...args: TArgs) => string // prompt factory
     maxOutputTokens?: number // optional cap; defaults to profile's contextWindowTokens
   }
   ```

   > `effort`, `postTo` from Helen's recipe type are intentionally omitted — they are Helen-specific concepts.

2. **Implement `recipe()` factory helper in `src/recipes/recipe.ts`**

   ```ts
   export function recipe<TArgs extends unknown[]>(def: Recipe<TArgs>): Recipe<TArgs> {
     return def
   }
   ```

   Thin factory for type inference — callers don't need to annotate `Recipe<[string, number]>` explicitly.

3. **Implement `runRecipe()` in `src/recipes/run-recipe.ts`**
   - Accepts `(runner: RunnerInstance, recipe: Recipe<TArgs>, args: TArgs): Promise<RunResult>`
   - Resolves the profile from `runner.config.profiles[recipe.profile]`
   - Gets the provider + language model from the registry
   - Gets the queue for this profile
   - Calls `queue.enqueue(profileKey, () => generateText({ model, prompt, maxTokens }))` from Vercel AI SDK
   - Computes `totalCostUsd` from token counts × `profile.costs.inputPer1M` / `profile.costs.outputPer1M` — omitted (undefined) if `profile.costs` is not set
   - Returns `{ text, usage: { inputTokens, outputTokens, totalCostUsd } }`
   - No tools, no messages, no system prompt — purely stateless

4. **Define `RunResult` in `src/recipes/types.ts`**

   ```ts
   export interface RunResult {
     text: string
     usage: {
       inputTokens: number
       outputTokens: number
       totalCostUsd: number
     }
   }
   ```

5. **Expose `runner.run()` on the `Runner` class** (wired up in Phase 6 but defined here)

   ```ts
   async run<TArgs extends unknown[]>(recipe: Recipe<TArgs>, ...args: TArgs): Promise<RunResult>
   ```

6. **Write tests in `tests/recipes/run-recipe.test.ts`**
   - Mock `generateText` to return fixed text + token counts
   - Verify prompt factory is called with `args`
   - Verify `text` matches the mocked response
   - Verify `usage.inputTokens` and `usage.outputTokens` match mock values
   - Verify `usage.totalCostUsd` is correctly calculated from profile cost rates
   - Verify queue is respected (mock the queue's `enqueue`)

---

### Phase 5: Session runner + progressive tool discovery

**Goal**: Implement the multi-turn session runner with explicit messages ownership and keyword-based progressive tool discovery.

#### Steps

1. **Define `DiscoverableTool` in `src/session/types.ts`**

   ```ts
   import type { CoreTool } from 'ai'

   export interface DiscoverableTool extends CoreTool {
     keywords?(): string[]
     // CoreTool provides: description, parameters, execute
   }

   export interface SessionOptions {
     profile: string
     systemPrompt?: string
     tools?: DiscoverableTool[]
   }

   export interface SendResult {
     messages: CoreMessage[] // from 'ai' (Vercel AI SDK); last entry is the assistant's response
     usage: {
       inputTokens: number
       outputTokens: number
       totalCostUsd: number
     }
   }
   ```

2. **Implement `send()` in `src/session/send.ts`**

   `send(runner: RunnerInstance, options: SessionOptions, messages: CoreMessage[], message: string): Promise<SendResult>`

   Steps inside `send()`:
   a. **Resolve profile**: look up `runner.config.profiles[options.profile]`; throw if not found.
   b. **Resolve active tools**: scan `messages` for assistant text content, joining into a single string. For each tool in `options.tools`, include it if it has no `keywords` or if any keyword appears in the messages text.
   c. **Build the message array**: append `{ role: 'user', content: message }` to `messages`.
   d. **Call `generateText`**:

   ```ts
   const result = await queue.enqueue(options.profile, () =>
     generateText({
       model,
       system: options.systemPrompt,
       messages: updatedMessages,
       tools: activeTools,
       maxTokens: resolvedProfile.contextWindowTokens,
     }),
   )
   ```

   e. **Append assistant response** to messages: `{ role: 'assistant', content: result.text }`.
   f. **Return** `{ messages: updatedMessages, usage: { ... } }`.

   > `send` is a standalone exported function, not a method. It accepts the runner as its first argument to access config/registry/queues.

3. **Implement `discoverTools()` helper in `src/session/discover-tools.ts`**
   - `discoverTools(messages: CoreMessage[], tools: DiscoverableTool[]): DiscoverableTool[]`
   - Joins all assistant text from messages into one string
   - For each tool: include if `keywords` is absent or returns `[]`; otherwise include only if a keyword appears in the messages text

4. **Write tests in `tests/session/send.test.ts`**
   - Single turn: mock `generateText`, verify returned `messages` has 2 entries (user + assistant)
   - Multi-turn: call `send()` twice with the returned messages; verify messages grows to 4 entries
   - Verify `messages.at(-1)` is the assistant's response
   - Tool discovery — absent keywords: tool is always included
   - Tool discovery — keyword match: tool included when keyword present in messages
   - Tool discovery — keyword no-match: tool excluded when keyword absent from messages
   - System prompt: verify `system` field passed to `generateText`
   - Verify queue `enqueue` is called

5. **Write tests in `tests/session/discover-tools.test.ts`**
   - Empty messages → only tools without keywords returned
   - History with keyword → matching tool revealed
   - History without keyword → non-matching tool hidden
   - Tool with `keywords: () => []` → always returned

---

### Phase 6: Runner class + public API

**Goal**: Wire all subsystems into the top-level `Runner` class and define the clean public `index.ts` export surface.

#### Steps

1. **Implement `Runner` in `src/runner.ts`**

   ```ts
   class Runner {
     readonly config: RunnerConfig
     readonly #registry: ProviderRegistry

     constructor(config: RunnerConfig) {
       this.config = config
       this.#registry = new ProviderRegistry(config) // resolves secrets once at construction
     }

     async run<TArgs extends unknown[]>(r: Recipe<TArgs>, ...args: TArgs): Promise<RunResult> {
       return runRecipe(this, r, args)
     }
   }
   ```

   - `Runner` owns a `ProviderRegistry` instance (not a module-level singleton — avoids cross-test contamination)
   - No `runner.session()` — callers construct a `SessionOptions` object directly and pass it to `send()`
   - `send()` is a standalone exported function; it accepts the runner to access config/registry/queues

2. **Create `src/index.ts`** — the library's public surface:

   ```ts
   // Core
   export { Runner } from './runner.js'
   export type { RunnerConfig, ModelProfile, QueueConfig } from './types.js'

   // Single-turn recipe API
   export { recipe } from './recipes/recipe.js'
   export type { Recipe, RunResult } from './recipes/types.js'

   // Multi-turn session API
   export { send } from './session/send.js'
   export type { SessionOptions, SendResult, DiscoverableTool } from './session/types.js'
   ```

3. **Verify `package.json` `exports`** align with `src/index.ts` — `"."` → `"./src/index.js"` for direct git installs.

4. **Integration tests in `tests/integration/runner.test.ts`**
   - Full round-trip (mock all `generateText` calls at the module boundary):
     - Construct `Runner` with two profiles
     - `runner.run(recipe, 'hello')` → `{ text, usage }`
     - Define `const options: SessionOptions = { profile: 'flash', systemPrompt: 'You are helpful.' }`
     - `send(runner, options, [], 'first message')` → `{ messages, usage }`
     - `send(runner, options, messages, 'second message')` → messages has 4 entries
   - Verify unknown profile in `send()` throws
   - Verify queue is shared across calls to the same profile

5. **Verify the full `npm run check` passes** (typecheck + format + tests)

---

## Progress

### Completed

- Repository created with LICENSE and feature doc template
- Phase 1: Project scaffold + core types
- Phase 2: Provider abstraction + ProviderQueue
- Phase 3: Provider implementations + ProviderRegistry
- Phase 4: Recipe system (single-turn)
- Phase 5: Session runner + progressive tool discovery
- Phase 6: Runner class + public API

### In Progress

- None

### Blocked

- None

### To Do

- None

## Technical Notes

### Why `Runner`-scoped registry, not module-level singletons

Helen's `registry.ts` uses module-level `factories`/`instances` objects. This means tests that import the registry share global state across test files. helen-runner scopes the registry to the `Runner` instance instead, so each `new Runner(config)` in tests gets a clean slate.

### Why `send()` is a standalone function, not a method

Helen's `Session.prompt()` is a method on a stateful object. The new design makes `send()` a standalone function so it is trivially testable without instantiating a class. The `Runner` is passed as the first argument (for access to config and registry); `SessionOptions` carries the static session config; the `messages` array carries the mutable conversation state. This separation makes the data flow explicit: nothing is hidden in `this`.

### Vercel AI SDK types vs `@anthropic-ai/claude-agent-sdk`

helen-runner wraps the Vercel AI SDK (`ai`) and its provider adapters — not the Claude Agent SDK. The Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`) is used by Friday and Helen's ACP session layer. helen-runner's `generateText` call uses Vercel AI SDK's `CoreMessage[]` as messages format.

### Provider coupling to `generateText`

The provider implementations expose `model(key): LanguageModel`. The `LanguageModel` type is from `ai` (Vercel AI SDK). This means all providers return a compatible object regardless of the underlying provider SDK. `generateText` accepts any `LanguageModel`, so there is no per-provider divergence in how calls are made.

### Secrets

The `Runner` accepts whatever values are in `config.secrets` and passes them straight through to the provider constructors. How those values get populated — env vars, a secrets manager, hardcoded strings in tests — is entirely the consumer's concern. helen-runner never reads `process.env`.

### Progressive tool discovery and Vercel AI SDK tool format

`DiscoverableTool extends CoreTool` from `ai`. The Vercel AI SDK's `CoreTool` shape requires `description: string`, `parameters: ZodSchema`, and `execute?: Function`. The `keywords?(): string[]` field is added by helen-runner and stripped before passing to `generateText` (Vercel AI SDK would ignore unknown fields, but stripping is cleaner).

## Files Modified/Created

### Services / Core

- `package.json` — project manifest
- `tsconfig.json` — TypeScript config
- `vitest.config.ts` — unit test runner config (excludes `*.smoke.ts`)
- `vitest.smoke.config.ts` — smoke test runner config (manually triggered)
- `.github/workflows/` — CI (copied from Helen; runs unit tests only)
- `.env.example` — secret key template
- `.gitignore` — ignore node_modules, dist, .env
- `src/types.ts` — `ModelProfile`, `QueueConfig`, `RunnerConfig`
- `src/providers/provider.ts` — `Provider` interface
- `src/providers/queue.ts` — `ProviderQueue` class
- `src/providers/registry.ts` — `ProviderRegistry` class
- `src/providers/open-router.ts` — OpenRouter provider
- `src/providers/google.ts` — Google provider
- `src/providers/openai.ts` — OpenAI provider
- `src/providers/anthropic.ts` — Anthropic provider
- `src/providers/ollama.ts` — Ollama provider
- `src/recipes/types.ts` — `Recipe<TArgs>` type
- `src/recipes/recipe.ts` — `recipe()` factory
- `src/recipes/run-recipe.ts` — `runRecipe()` implementation
- `src/session/types.ts` — `DiscoverableTool`, `SessionOptions`, `SendResult`
- `src/session/send.ts` — `send()` function
- `src/session/discover-tools.ts` — `discoverTools()` helper
- `src/runner.ts` — `Runner` class
- `src/index.ts` — public exports

### Tests

- `tests/types.test.ts` — type shape validation
- `tests/providers/queue.test.ts` — `ProviderQueue` concurrency + rate limiting
- `tests/providers/registry.test.ts` — singleton behavior, unknown keys
- `tests/smoke/open-router.smoke.ts` — live OpenRouter request
- `tests/smoke/google.smoke.ts` — live Google request
- `tests/smoke/openai.smoke.ts` — live OpenAI request
- `tests/smoke/anthropic.smoke.ts` — live Anthropic request
- `tests/smoke/ollama.smoke.ts` — live Ollama request (local)
- `tests/providers/open-router.test.ts` — OpenRouter model resolution
- `tests/providers/google.test.ts` — Google model resolution
- `tests/providers/openai.test.ts` — OpenAI model resolution
- `tests/providers/anthropic.test.ts` — Anthropic model resolution
- `tests/providers/ollama.test.ts` — Ollama no-key setup
- `tests/recipes/run-recipe.test.ts` — single-turn execution
- `tests/session/discover-tools.test.ts` — keyword gating logic
- `tests/session/send.test.ts` — multi-turn messages, tool discovery, system prompt
- `tests/integration/runner.test.ts` — full round-trip

## Questions/Decisions Needed

- [ ] Should `ProviderQueue` use a third-party library (`p-queue`, `bottleneck`) for rate limiting, or implement the token bucket manually? Manual is zero-dep; p-queue is well-tested. Decision needed before Phase 2.
- [ ] Should `send()` support tool-use turns (where the model calls a tool and helen-runner executes it and continues)? Or is the initial scope just single-model-turn per `send()` call? Clarify before Phase 5.
- [ ] Should `SessionOptions` accept a `maxTurns` or `maxBudgetUsd` cap (Vercel AI SDK supports these on `generateText`)? Or leave them as optional per-`send()` overrides?

## Decisions Made

- **No streaming**: `generateText` only; `streamText` is out of scope.
- **`send()` is a pure function**: messages in, `{ messages, usage }` out. Runner holds no inter-call state.
- **Config at construction time**: `RunnerConfig` passed to `Runner` constructor; not read lazily.
- **Registry scoped to Runner instance**: avoids module-level singleton cross-test contamination.
- **No npm publishing yet**: plain git repo; Helen will import via git URL when ready.
- **Secrets**: passed straight through via `RunnerConfig.secrets`; helen-runner never reads `process.env`. How values are sourced is the consumer's concern.

## Session History

### Session 1

- Design note written (note 180) capturing full API surface, types, design constraints, and key files to extract from Helen.
- Planning complete: 6-phase plan written to feature doc.
