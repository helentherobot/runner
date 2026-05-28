# Quality of Life

- Branch: `feature/002-quality-of-life`

## Overview

`@helentherobot/runner` is the library that wraps the Vercel AI SDK for Helen's model interactions. It exposes `send()` for multi-turn conversations and `Runner.run()` for single-step recipe execution. Both ultimately call `generateText()` from the AI SDK, but neither passes an `abortSignal` nor enforces any timeout logic. A hung model call — due to a provider outage, a rate limit spin, or a slow streaming response — stalls indefinitely with no recovery path.

`ModelProfile` already declares `requestTimeoutMs` as a required field, but no code in the library reads it. The value has always been dead config. Additionally, there is no typed error surface: callers cannot distinguish a timeout from a cancellation from a provider error without string-matching on `.message`.

This feature wires up the timeout field, adds per-step retry logic with message rollback for `send()`, adds single-step timeout and retry for `Runner.run()`, and exports typed error classes so callers can handle each failure mode explicitly. The library is bumped to `0.2.0` to signal the enhanced contract.

### Background / Current Behavior

- **Current behavior**: `send()` and `Runner.run()` call `generateText()` with no `abortSignal`, no `timeout`, and no retry orchestration. The AI SDK defaults silently retry twice at the HTTP level, but `requestTimeoutMs` in the profile is never consulted.
- **Problem**: A hung call stalls the queue entry indefinitely; Helen sessions block with no recovery. Callers cannot catch a `RequestTimeoutError` because no such class exists.
- **Where it happens**: `src/session/send.ts`, `src/recipes/run-recipe.ts`
- **Impact**: Any downstream consumer of `@helentherobot/runner` (Helen) inherits the hang and must implement its own ad-hoc timeout workarounds, or accept that slow model calls block forever.

### Target Outcome

This feature will add timeout enforcement, retry-with-rollback, external cancellation support, and typed errors to `@helentherobot/runner` so that callers can:

- Pass an `AbortSignal` to cancel any in-flight `send()` or `Runner.run()` call from outside
- Trust that `send()` will automatically retry on per-step timeout up to `maxRetries` times, rolling back message state between attempts
- Trust that `Runner.run()` will apply a single-step timeout and retry up to `maxRetries` times
- Catch `RequestTimeoutError` or `RequestCancelledError` and handle each case explicitly

## Requirements

### Functional

- [ ] `ModelProfile` accepts an optional `maxRetries?: number` field (default: `3` at the call site)
- [ ] `SessionOptions` accepts an optional `abortSignal?: AbortSignal` field, forwarded to `generateText`
- [ ] `send()` creates an internal `AbortController`, merges it with any caller-supplied signal via `AbortSignal.any()`, and resets a per-step timeout via `onStepFinish`
- [ ] `send()` retries on timeout up to `profile.maxRetries ?? 3` times, rolling back messages to the pre-call snapshot between attempts, backing off ~1s between retries
- [ ] `send()` throws `RequestTimeoutError` after exhausting retries; throws `RequestCancelledError` if the caller's signal fires
- [ ] `Runner.run()` accepts an optional `{ abortSignal?: AbortSignal }` options bag as a fourth parameter
- [ ] `Runner.run()` and `runRecipe()` apply `profile.requestTimeoutMs` as a single-step timeout and retry up to `profile.maxRetries ?? 3` times via the AI SDK's own `timeout` and `maxRetries` options
- [ ] `RequestTimeoutError` and `RequestCancelledError` are exported from the library's public index
- [ ] `package.json` version is `0.2.0`

### Non-Functional

- [ ] Backwards compatibility: all changes are additive; no existing call sites break
- [ ] Node 20+ assumed: `AbortSignal.any()` used without polyfill (confirmed available on Node 24)
- [ ] The AI SDK's internal `maxRetries` is not relied upon for the application-level retry loop in `send()` (set to `0` to prevent double-retrying)

### Out of Scope

- Wiring `abortSignal` into the queue itself (pre-dispatch cancellation of enqueued entries)
- Per-call `timeoutMs` override on `send()` (profile-level is sufficient)
- Streaming / partial result capture on timeout
- Any changes to Helen's `Session` class

## Implementation Plan

> **Code style**: No useless comments. Only add comments that explain tricky/non-obvious code.
> **Before committing**: Run `npm run format` and `npm test` before every commit.
> **No auto-committing**: Only commit when explicitly asked. `git status`/`git diff`/`git log` are read-only — never follow them with `git add` or `git commit` unless Chris said "commit."
> **One step at a time**: When the implementation plan has numbered steps, complete only the current step before asking to proceed. Do not work ahead into future steps.
> **No verbose paths**: Do not specify the working directory in commands when it matches the current directory.

---

### Phase 1 — Type system extensions + tests

**Goal**: Add `maxRetries` to `ModelProfile` and `abortSignal` to `SessionOptions`. No runtime behaviour changes yet — type system only.

#### Steps

1. **`src/types.ts`** — Add `maxRetries?: number` to `ModelProfile` after the existing optional fields (`costs`, `providerOptions`):

   ```ts
   maxRetries?: number
   ```

   Keep it optional so existing profile configs require no changes.

2. **`src/session/types.ts`** — Add `abortSignal?: AbortSignal` to `SessionOptions` after `scope`:

   ```ts
   abortSignal?: AbortSignal
   ```

   `AbortSignal` is a Node.js/browser global — no import needed.

3. **`tests/types.test.ts`** — Add type-level tests for `maxRetries` on `ModelProfile`:
   - A profile with `maxRetries: 3` satisfies `ModelProfile`
   - A profile omitting `maxRetries` still satisfies `ModelProfile`
   - A profile with `maxRetries: 'three'` produces a type error (`@ts-expect-error`)

4. **`tests/session/send.test.ts`** — Add a test asserting that `SessionOptions` accepts `abortSignal`:
   - Construct a `SessionOptions` object with `abortSignal: new AbortController().signal` and assert it satisfies the type (no runtime assertion needed for phase 1 — runtime threading is phase 3)

#### Files touched

| File                         | Change                                                |
| ---------------------------- | ----------------------------------------------------- |
| `src/types.ts`               | Add `maxRetries?: number` to `ModelProfile`           |
| `src/session/types.ts`       | Add `abortSignal?: AbortSignal` to `SessionOptions`   |
| `tests/types.test.ts`        | Type-level tests for `maxRetries`                     |
| `tests/session/send.test.ts` | Type-level test for `abortSignal` on `SessionOptions` |

---

### Phase 2 — Typed error classes + tests

**Goal**: Create `src/errors.ts` with `RequestTimeoutError` and `RequestCancelledError`, export them from `src/index.ts`, and add unit tests.

#### Steps

1. **Create `src/errors.ts`**:

   ```ts
   export class RequestTimeoutError extends Error {
     constructor(retries: number) {
       super(`Request timed out after ${retries} ${retries === 1 ? 'retry' : 'retries'}`)
       this.name = 'RequestTimeoutError'
     }
   }

   export class RequestCancelledError extends Error {
     constructor() {
       super('Request was cancelled')
       this.name = 'RequestCancelledError'
     }
   }
   ```

2. **`src/index.ts`** — Add named exports (not type-only — these are runtime classes):

   ```ts
   export { RequestTimeoutError, RequestCancelledError } from './errors.js'
   ```

3. **Create `tests/errors.test.ts`**:
   - `RequestTimeoutError` is an instance of `Error`
   - `RequestTimeoutError` has `.name === 'RequestTimeoutError'`
   - `RequestTimeoutError` message includes the retry count
   - `RequestCancelledError` is an instance of `Error`
   - `RequestCancelledError` has `.name === 'RequestCancelledError'`
   - Both are exported from the package index (import them from `../../src/index.js` and confirm)

#### Files touched

| File                   | Change                                                       |
| ---------------------- | ------------------------------------------------------------ |
| `src/errors.ts`        | New file — `RequestTimeoutError` and `RequestCancelledError` |
| `src/index.ts`         | Export both error classes                                    |
| `tests/errors.test.ts` | New test file                                                |

---

### Phase 3 — Timeout & retry in `send()` + tests

**Goal**: Wire `requestTimeoutMs` and `maxRetries` into `send()`. Each call gets a per-step timeout that resets on `onStepFinish`. On timeout, messages roll back and the call retries. On caller cancellation, throw `RequestCancelledError`. After exhausting retries, throw `RequestTimeoutError`.

#### Key facts from research

- `send()` is in `src/session/send.ts`
- `updatedMessages` is the local copy `[...messages, userTurn]` — it is the natural rollback snapshot
- `onStepFinish` is not currently used — safe to add
- `AbortSignal.any()` is available (Node 24)
- The AI SDK's internal `maxRetries` should be set to `0` to prevent it silently retrying at the HTTP level; we own the retry loop at the application level

#### Steps

1. **`src/session/send.ts`** — Restructure the `generateText` call inside `queue.enqueue`:

   a. Extract the pre-call message snapshot: `const snapshot = [...updatedMessages]`

   b. Wrap the `generateText` invocation in an outer retry loop (`attempt = 0` to `maxRetries`):

   ```ts
   const maxRetries = profile.maxRetries ?? 3

   for (let attempt = 0; attempt <= maxRetries; attempt++) {
     const controller = new AbortController()
     let timeoutId: ReturnType<typeof setTimeout> | null = null

     const resetTimeout = () => {
       if (timeoutId) clearTimeout(timeoutId)
       if (profile.requestTimeoutMs) {
         timeoutId = setTimeout(() => controller.abort('request-timeout'), profile.requestTimeoutMs)
       }
     }

     const mergedSignal = options.abortSignal
       ? AbortSignal.any([controller.signal, options.abortSignal])
       : controller.signal

     resetTimeout()

     try {
       const result = await generateText({
         model,
         system: options.systemPrompt,
         messages: updatedMessages,
         tools,
         maxOutputTokens,
         maxRetries: 0,  // disable SDK-level retries; we own the loop
         abortSignal: mergedSignal,
         onStepFinish: () => resetTimeout(),
       })

       if (timeoutId) clearTimeout(timeoutId)
       // success — append assistant turn and return
       updatedMessages.push({ role: 'assistant', content: result.text })
       return { messages: updatedMessages, usage: { ... } }

     } catch (err) {
       if (timeoutId) clearTimeout(timeoutId)

       // If caller cancelled externally, throw immediately — do not retry
       if (options.abortSignal?.aborted) {
         throw new RequestCancelledError()
       }

       const isTimeout = controller.signal.aborted &&
         controller.signal.reason === 'request-timeout'

       if (isTimeout && attempt < maxRetries) {
         // Roll back to pre-call snapshot and retry
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
   ```

   c. Add a local `sleep` helper (just `await new Promise(r => setTimeout(r, ms))`).

   d. Import `RequestTimeoutError` and `RequestCancelledError` from `'../errors.js'`.

2. **`tests/session/send.test.ts`** — Add test cases:
   - `generateText` receives `abortSignal` when `options.abortSignal` is set
   - `generateText` receives `abortSignal` when no caller signal (internal only)
   - `generateText` is called with `maxRetries: 0`
   - `generateText` receives `onStepFinish` callback
   - On timeout (mock `generateText` to reject with a timeout abort): retries up to `maxRetries` times
   - On timeout exhaustion: throws `RequestTimeoutError`
   - On caller abort before retry: throws `RequestCancelledError` without retrying
   - Successful call after one timeout retry: returns correct messages

#### Files touched

| File                         | Change                                                                         |
| ---------------------------- | ------------------------------------------------------------------------------ |
| `src/session/send.ts`        | Retry loop, AbortController, onStepFinish, timeout reset, error classification |
| `src/errors.ts`              | (created in phase 2 — imported here)                                           |
| `tests/session/send.test.ts` | New test cases for timeout, retry, cancellation                                |

---

### Phase 4 — Timeout & retry in `Runner.run()` + tests

**Goal**: Add an optional options bag to `Runner.run()`, thread `abortSignal` and timeout through to `runRecipe()`, and wire `profile.requestTimeoutMs` and `profile.maxRetries` into the `generateText` call. Single-step recipe — no message rollback needed.

#### Key facts from research

- `Runner.run()` in `src/runner.ts` currently has three params: `r`, `args`, `scope`
- `runRecipe()` in `src/recipes/run-recipe.ts` calls `generateText({ model, prompt, maxOutputTokens })`
- The AI SDK accepts `timeout` as a plain number (ms) and `maxRetries` as a number directly on `generateText`
- No queue changes required — the `AbortSignal` is constructed in the `fn` closure passed to `queue.enqueue`

#### Steps

1. **`src/recipes/types.ts`** (or `src/types.ts` if no such file exists — confirm during implementation) — Define and export `RunOptions`:

   ```ts
   export interface RunOptions {
     abortSignal?: AbortSignal
   }
   ```

2. **`src/index.ts`** — Export `RunOptions`.

3. **`src/runner.ts`** — Add `options?: RunOptions` as a fourth parameter to `run()` and pass it through to `runRecipe()`:

   ```ts
   async run<TArgs extends unknown[]>(
     r: Recipe<TArgs>,
     args: TArgs,
     scope?: string,
     options?: RunOptions,
   ): Promise<RunResult>
   ```

4. **`src/recipes/run-recipe.ts`** — Accept `options?: RunOptions` and wire into `generateText`:

   a. Derive the merged abort signal:

   ```ts
   const timeoutSignal = profile.requestTimeoutMs
     ? AbortSignal.timeout(profile.requestTimeoutMs)
     : undefined

   const abortSignal =
     [timeoutSignal, options?.abortSignal].filter(Boolean).length > 0
       ? AbortSignal.any([timeoutSignal, options?.abortSignal].filter((s): s is AbortSignal => !!s))
       : undefined
   ```

   b. Pass to `generateText`:

   ```ts
   generateText({
     model,
     prompt,
     maxOutputTokens,
     maxRetries: profile.maxRetries ?? 3,
     abortSignal,
   })
   ```

   c. Wrap in a try/catch to classify the error on exhaustion:

   ```ts
   try {
     return await queue.enqueue(scope ?? r.profile, () => generateText({ ... }))
   } catch (err) {
     if (options?.abortSignal?.aborted) throw new RequestCancelledError()
     throw err
   }
   ```

   Note: the AI SDK throws `RetryError` (with a `lastError`) after exhausting `maxRetries`. We do not reclassify this as `RequestTimeoutError` unless the `lastError` is a timeout-caused abort — keep it simple for now and let the SDK's error propagate. Only explicit external cancellation gets reclassified.

5. **`tests/recipes/run-recipe.test.ts`** — Add test cases:
   - `generateText` receives `abortSignal` derived from `profile.requestTimeoutMs`
   - `generateText` receives `abortSignal` merged with caller-supplied signal
   - `generateText` receives `maxRetries` from `profile.maxRetries`
   - `generateText` receives `maxRetries: 3` (default) when profile omits `maxRetries`
   - Caller abort throws `RequestCancelledError`

6. **`tests/integration/runner.test.ts`** — Add integration-level test cases:
   - `runner.run(recipe, args, scope, { abortSignal })` passes the signal through
   - A profile with `requestTimeoutMs` produces a merged signal in the `generateText` call

#### Files touched

| File                                       | Change                                                                    |
| ------------------------------------------ | ------------------------------------------------------------------------- |
| `src/recipes/types.ts` (or `src/types.ts`) | Add `RunOptions` interface                                                |
| `src/runner.ts`                            | Add `options?: RunOptions` param, thread through to `runRecipe`           |
| `src/recipes/run-recipe.ts`                | Accept options, derive merged signal, pass `maxRetries` to `generateText` |
| `src/index.ts`                             | Export `RunOptions`                                                       |
| `tests/recipes/run-recipe.test.ts`         | New test cases                                                            |
| `tests/integration/runner.test.ts`         | New integration test cases                                                |

---

### Phase 5 — Version bump

**Goal**: Update `package.json` version from `0.1.1` to `0.2.0`.

#### Steps

1. **`package.json`** — Change `"version": "0.1.1"` to `"version": "0.2.0"`.
2. Run `npm test` to confirm the suite is still green. No other files change in this phase.

#### Files touched

| File           | Change               |
| -------------- | -------------------- |
| `package.json` | `"version": "0.2.0"` |

---

## Progress

### Completed

- Phase 1 — Type system extensions + tests
- Phase 2 — Error classes + tests
- Phase 3 — Timeout & retry in `send()` + tests

### In Progress

-

### Blocked

-

### To Do

- Phase 4 — Timeout & retry in `Runner.run()` + tests
- Phase 5 — Version bump

## Technical Notes

**Why per-step timeout and not total-call timeout in `send()`**
`send()` can make multiple LLM steps (tool calls). A total timeout would fire mid-tool-loop. A per-step timeout means each individual model call gets `requestTimeoutMs` ms; the timer resets between steps via `onStepFinish`. This prevents punishing legitimate multi-step flows while still catching genuinely hung individual calls.

**Why `maxRetries: 0` on `generateText` inside `send()`**
The AI SDK silently retries twice at the HTTP level by default. If we also have an outer application retry loop, a single logical attempt can trigger up to 3 × 3 = 9 real HTTP calls. Setting `maxRetries: 0` on the SDK means our outer loop is the sole retry authority, making retry counts predictable.

**Why the AI SDK's built-in `timeout` option is used in `runRecipe()` but not `send()`**
Recipes are single-step — `generateText` fires once and returns. The SDK's `timeout` option plus `AbortSignal.any()` is cleanest there. `send()` uses a custom `AbortController` + `setTimeout` loop because it needs to reset the timer on each step via `onStepFinish` and own the retry/rollback logic explicitly.

**`requestTimeoutMs` was always dead config**
Before this feature, `ModelProfile.requestTimeoutMs` was declared in types and required in every profile fixture, but never read by any runtime code. This feature is what finally makes it do something.

**`AbortSignal.any()` availability**
Confirmed available in Node 20+ (this project targets Node 24). No polyfill needed.

## Files Modified/Created

### Services / Core

- `src/types.ts` — `maxRetries?: number` on `ModelProfile`
- `src/session/types.ts` — `abortSignal?: AbortSignal` on `SessionOptions`
- `src/errors.ts` — New: `RequestTimeoutError`, `RequestCancelledError`
- `src/session/send.ts` — Per-step timeout, AbortController, retry loop, error classification
- `src/recipes/run-recipe.ts` — `timeout`, `maxRetries`, `abortSignal` wired into `generateText`
- `src/runner.ts` — `options?: RunOptions` fourth param
- `src/index.ts` — Export `RequestTimeoutError`, `RequestCancelledError`, `RunOptions`
- `package.json` — Version `0.2.0`

### Tests

- `tests/types.test.ts` — Type-level assertions for `maxRetries`
- `tests/errors.test.ts` — New: unit tests for both error classes
- `tests/session/send.test.ts` — Timeout, retry, rollback, and cancellation cases
- `tests/recipes/run-recipe.test.ts` — Signal merging, `maxRetries`, cancellation
- `tests/integration/runner.test.ts` — End-to-end signal threading

## Questions/Decisions Needed

- [ ] Should `RequestTimeoutError` reclassify the AI SDK's `RetryError` in `runRecipe()` (when the last retry was a timeout)? Currently scoped out — SDK error propagates as-is.

## Decisions Made

- Per-step timeout (not total-call) for `send()` — resets via `onStepFinish`
- `maxRetries: 0` on SDK in `send()` to prevent double-retrying
- AI SDK's built-in `timeout` option used in `runRecipe()` (simpler for single-step)
- `requestTimeoutMs` wired into both paths (it was previously dead config)

## Session History

### Session 1

- Planned timeout & cancellation support, typed errors, and version bump to 0.2.0
