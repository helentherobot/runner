# Send Hooks

- Branch: `feature/003-send-hooks`

## Overview

`@helentherobot/runner`'s `send()` function drives a multi-step `generateText` loop internally, but exposes minimal options to callers. It handles model resolution, queue management, and timeout-based retry — but lacks the lifecycle hooks and extension points that any sufficiently complex caller will need before it can replace a hand-rolled `generateText` loop entirely.

This feature adds eleven targeted additions to `send()` and its `SessionOptions` type: mirrors of existing AI SDK options (`prepareStep`, `onStepFinish`, `stopWhen`, `providerOptions`), a new retry surface (`isRetryable`, `onRetry`, `backoffMs`), a tool-execution timeout (`toolTimeoutMs`), a breaking signature simplification, a lazy tools closure, and a fix for a long-standing `maxOutputTokens` bug. All additions are optional — existing callers are unaffected unless they opt in.

### Background / Current Behavior

- **Current behavior**: `send()` accepts a flat `messages` array plus a separate `message` string, calls `generateText` with a fixed set of options (no step hooks, no stop condition, no provider options, no retry customisation), and retries only on timeout with a flat 1000ms backoff.
- **Problem**: Callers that need context-window compaction, step-level logging, controlled stopping, rate-limit retries, or per-model provider options are forced to bypass `send()` and hand-roll their own loops. The `maxOutputTokens` field is also silently wrong — it passes `contextWindowTokens` (the total context budget) as the maximum generation length.
- **Where it happens**: `src/session/send.ts` and `src/session/types.ts`
- **Impact**: Helen Phase 4 cannot use `send()` as its primary loop driver without these hooks. Any caller that needs compaction, tool-aware timeouts, or retry observability must bypass the library entirely.

### Target Outcome

This feature will extend `send()` with a complete set of lifecycle and retry hooks so that callers can:

- Inspect and rewrite the message list before each model step (context-window compaction)
- Observe step results without re-implementing the loop
- Cap the number of steps via a caller-supplied stop condition
- Pass provider-specific options through from the model profile
- Retry on non-timeout errors with customisable predicates, callbacks, and backoff
- Use a longer timeout during tool execution than during model inference
- Pass a fully-assembled message list without splitting off the last user turn
- Supply a lazy closure for the tool list that is evaluated fresh each step

## Requirements

### Functional

- [ ] `prepareStep` hook in `SessionOptions`: called before each model invocation; can return `{ messages }` to replace the message list or `void` to leave it unchanged; receives `{ messages, steps }` so callers can inspect token usage from the previous step
- [ ] `onStepFinish` hook in `SessionOptions`: called after each step, after the internal `resetTimeout()` call; receives the `StepResult`
- [ ] `stopWhen` in `SessionOptions`: passed through to `generateText` as-is; accepts `StopCondition` or `StopCondition[]`
- [ ] `providerOptions` from `ModelProfile` threaded through to `generateText`; no new `SessionOptions` field required (already exists on the profile)
- [ ] `isRetryable(error): boolean` in `SessionOptions`: consulted for non-timeout errors; if it returns true and attempts remain, the error is retried the same as a timeout
- [ ] `onRetry(attempt, maxAttempts, reason)` in `SessionOptions`: called before each retry attempt (after determining we will retry, before rollback and sleep); reason is `'timeout'` or the error's `.name`
- [ ] `backoffMs(attempt, reason): number` in `SessionOptions`: replaces the hardcoded 1000ms sleep; defaults to 1000 if not provided
- [ ] `send()` signature simplified to `(runner, options, messages: (CoreMessage | string)[])`: strings are coerced to `{ role: 'user', content: string }` internally; the fourth `message` parameter is removed
- [ ] `toolTimeoutMs` in `SessionOptions`: when a step finishes with pending tool calls (`step.toolCalls.length > 0`), the abort timer is reset with `toolTimeoutMs` instead of `requestTimeoutMs` for the tool execution phase; reverts to `requestTimeoutMs` on the next model call; falls back to `requestTimeoutMs` if `toolTimeoutMs` is not set
- [ ] Fix `maxOutputTokens` bug: remove the `maxOutputTokens: profile.contextWindowTokens` line (line 68 of `send.ts`); do not replace with anything unless a future `SessionOptions` field is added for it
- [ ] `tools` in `SessionOptions` accepts `DiscoverableTool[] | (() => DiscoverableTool[])`: if a function is provided it is called once before the retry loop; the static array form is unchanged

### Non-Functional

- [ ] Observability: no new logging requirements; all hooks give callers the instrumentation surface they need
- [ ] Performance: no hot-path allocations beyond what hooks already allocate; lazy tool closure is called once per `send()` call, not per step
- [ ] Security/Permissions: no changes to auth or access control
- [ ] Backwards compatibility: every new `SessionOptions` field is optional; all 19 unit test call sites and 8 integration test call sites must be migrated from the old signature to the new one

### Out of Scope

- Per-call `maxRetries` override (callers use the profile value)
- Per-call `model` override (callers use a different profile string)
- `prepareStep` returning anything other than `{ messages? }` or `void`
- Lazy tool closure being called more than once per `send()` invocation

## Implementation Plan

> **Code style**: No useless comments. Only add comments that explain tricky/non-obvious code.
> **Before committing**: Run `npm run format` and `npm test` before every commit.
> **No auto-committing**: Only commit when explicitly asked.
> **One step at a time**: Complete the current phase before starting the next.

---

### Phase 1 — Fix `maxOutputTokens` bug + audit

**Scope**: Fix the `maxOutputTokens: profile.contextWindowTokens` bug in `send.ts` line 68, and lay eyes on the full file before any other changes land.

**Steps**:

1. Read `src/session/send.ts` and `src/session/types.ts` in full to confirm nothing has changed since the research phase.
2. In `src/session/send.ts`, remove the `maxOutputTokens: profile.contextWindowTokens` line from the `generateText` call. Do not add a replacement — let `generateText` use its own default.
3. Confirm the `generateText` call now has no `maxOutputTokens` argument.
4. **Tests** (`tests/session/send.test.ts`):
   - Add a test asserting that `generateText` is **not** called with a `maxOutputTokens` argument (i.e., the key is absent or `undefined`).
   - Existing tests must still pass.
5. Run `npm run format && npm test`.

---

### Phase 2 — AI SDK pass-throughs: `prepareStep`, `onStepFinish`, `stopWhen`, `providerOptions`

**Scope**: Thread four options from `SessionOptions` (or `ModelProfile`) through to `generateText`.

**Steps**:

1. **Types** (`src/session/types.ts`): Add three optional fields to `SessionOptions`:

   ```ts
   prepareStep?: (ctx: {
     messages: CoreMessage[]
     steps: StepResult[]
   }) => Promise<{ messages?: CoreMessage[] } | void> | { messages?: CoreMessage[] } | void

   onStepFinish?: (step: StepResult) => void | Promise<void>

   stopWhen?: StopCondition | StopCondition[]
   ```

   Import `CoreMessage`, `StepResult`, and `StopCondition` from `'ai'` at the top of the file.

2. **Runtime** (`src/session/send.ts`): Update the `generateText` call to pass:
   - `prepareStep: options.prepareStep` — pass through as-is
   - `stopWhen: options.stopWhen` — pass through as-is
   - `providerOptions: profile.providerOptions` — read from the resolved profile

3. **`onStepFinish` composition**: The existing internal `onStepFinish: () => resetTimeout()` must be preserved. Replace it with a wrapper that:
   - Calls `resetTimeout()` first (to preserve existing timeout-reset behaviour)
   - Then calls `await options.onStepFinish?.(step)` if provided

   The combined handler is always present; the external callback is optional.

4. **Imports** (`src/session/send.ts`): Add type imports for `StepResult`, `StopCondition`, and any other new types. `CoreMessage` import will be needed in Phase 4 but may as well be added here.

5. **Tests** (`tests/session/send.test.ts`):
   - `prepareStep`: verify the callback is called before each step; verify returning `{ messages }` replaces the message list for the next step; verify returning `void` leaves the list unchanged
   - `onStepFinish`: verify the external callback is invoked for each step; verify it receives the `StepResult`; verify `resetTimeout()` fires even when no external callback is provided (existing timeout behaviour)
   - `stopWhen`: verify it is forwarded to `generateText` unchanged (spy on the argument)
   - `providerOptions`: set `providerOptions` on the mock profile; verify it is forwarded to `generateText`
6. Run `npm run format && npm test`.

---

### Phase 3 — Retry surface: `isRetryable`, `onRetry`, `backoffMs`

**Scope**: Extend the retry loop with three new caller-supplied hooks for non-timeout errors, observability, and backoff control.

**Steps**:

1. **Types** (`src/session/types.ts`): Add three optional fields to `SessionOptions`:

   ```ts
   isRetryable?: (error: unknown) => boolean
   onRetry?: (attempt: number, maxAttempts: number, reason: string) => void
   backoffMs?: (attempt: number, reason: string) => number
   ```

2. **Runtime** (`src/session/send.ts`) — refactor the catch block:

   Current flow:

   ```
   if user aborted → throw RequestCancelledError
   if timeout && attempts remain → rollback, sleep(1000), continue
   if timeout && no attempts remain → throw RequestTimeoutError
   throw err (all other errors)
   ```

   New flow:

   ```
   if user aborted → throw RequestCancelledError

   const reason = isTimeout ? 'timeout' : (err as Error)?.name ?? 'error'
   const willRetry = (isTimeout || options.isRetryable?.(err) === true) && attempt < maxRetries

   if willRetry:
     options.onRetry?.(attempt, maxRetries, reason)
     updatedMessages.length = 0
     updatedMessages.push(...snapshot)
     await sleep(options.backoffMs?.(attempt, reason) ?? 1000)
     continue

   if isTimeout → throw RequestTimeoutError(maxRetries)
   throw err
   ```

   Notes:
   - Built-in timeout check still runs first; `isRetryable` is only consulted for non-timeout errors.
   - `onRetry` fires before rollback and sleep so the caller can see the attempt number before waiting.
   - `backoffMs` replaces the hardcoded `1000`; falls back to `1000` if not provided.

3. **Tests** (`tests/session/send.test.ts`):
   - `isRetryable` returns `false` for a non-timeout error → error is rethrown immediately, no sleep, no retry
   - `isRetryable` returns `true` for a non-timeout error → error is retried; `generateText` is called again; `onRetry` fires
   - `onRetry` receives correct `attempt`, `maxAttempts`, and `reason` on each retry
   - `backoffMs` return value is used as the sleep duration (spy on `sleep` or use fake timers)
   - Fallback: when `backoffMs` is absent, sleep is 1000ms (existing behaviour)
   - Existing timeout retry tests must still pass
4. Run `npm run format && npm test`.

---

### Phase 4 — Signature change + `toolTimeoutMs` + lazy `tools`

**Scope**: Three related changes to `send()`'s interface: remove the fourth `message` parameter, add tool-phase timeout, and allow `tools` to be a lazy closure.

**Steps**:

1. **Signature change** (`src/session/send.ts`):

   Change:

   ```ts
   export async function send(
     runner: RunnerInstance,
     options: SessionOptions,
     messages: ModelMessage[],
     message: string,
   ): Promise<SendResult>
   ```

   To:

   ```ts
   export async function send(
     runner: RunnerInstance,
     options: SessionOptions,
     messages: (CoreMessage | string)[],
   ): Promise<SendResult>
   ```

   Inside the function, replace:

   ```ts
   const updatedMessages: ModelMessage[] = [...messages, { role: 'user', content: message }]
   ```

   With:

   ```ts
   const updatedMessages: CoreMessage[] = messages.map((m) =>
     typeof m === 'string' ? { role: 'user', content: m } : m,
   )
   ```

   Update `SendResult.messages` type from `ModelMessage[]` to `CoreMessage[]` in `src/session/types.ts`.

   Remove the `ModelMessage` import if it is no longer used; confirm `CoreMessage` is imported from `'ai'`.

2. **`toolTimeoutMs`** (`src/session/types.ts`): Add:

   ```ts
   toolTimeoutMs?: number
   ```

   In `src/session/send.ts`, replace the plain `onStepFinish: async (step) => { resetTimeout(); ... }` body with logic that detects tool calls on the completed step and chooses the appropriate timeout:

   ```ts
   const timeoutMs =
     step.toolCalls.length > 0 && options.toolTimeoutMs != null
       ? options.toolTimeoutMs
       : profile.requestTimeoutMs
   resetTimeout(timeoutMs)
   ```

   Update `resetTimeout()` to accept an optional `ms` argument that overrides `profile.requestTimeoutMs`. When no argument is passed it uses `profile.requestTimeoutMs` (existing behaviour).

3. **Lazy `tools`** (`src/session/types.ts`): Change the `tools` field:

   ```ts
   tools?: DiscoverableTool[] | (() => DiscoverableTool[])
   ```

   In `src/session/send.ts`, before the retry loop where `discoverTools` is called, normalise the tools value:

   ```ts
   const toolsArray = typeof options.tools === 'function' ? options.tools() : (options.tools ?? [])
   const activeTools = discoverTools(updatedMessages, toolsArray)
   ```

   The closure is called once per `send()` invocation, before the loop.

4. **Update all callers** — migrate the old `(runner, options, messages, message)` signature to `(runner, options, [...messages, message])`:
   - `tests/session/send.test.ts`: 19 call sites
   - `tests/integration/runner.test.ts`: 8 call sites
   - Search for any other callers with: `grep -r 'send(' src/ tests/`

5. **Update `src/session/discover-tools.ts`** if its `messages` parameter type is `ModelMessage[]` — change to `CoreMessage[]`.

6. **Tests** (`tests/session/send.test.ts`):
   - Verify a plain string in the messages array is coerced to `{ role: 'user', content: string }`
   - Verify a `CoreMessage` object is passed through unchanged
   - `toolTimeoutMs`: mock a step result with `toolCalls.length > 0`; verify the abort timer is reset with `toolTimeoutMs`, not `requestTimeoutMs`; verify model steps use `requestTimeoutMs`
   - Lazy tools: pass `() => [tool]`; verify the tool appears in the `generateText` call; verify the closure is called exactly once

7. Run `npm run format && npm test`.

---

### Phase 5 — Versioning & README

**Scope**: Bump `package.json` to `0.3.0` and document all changes in the README.

**Steps**:

1. In `package.json`, change `"version": "0.2.0"` to `"version": "0.3.0"`.

2. In `README.md`, update the "Sessions — multi-turn conversations" section:

   a. **Breaking change callout** at the top of the section:
   - State that `0.3.0` removes the fourth `message: string` parameter.
   - Show the before/after migration pattern:

     ```ts
     // before (0.2.x)
     send(runner, options, history, 'new user message')

     // after (0.3.0)
     send(runner, options, [...history, 'new user message'])
     ```

   b. **Step lifecycle hooks** subsection — document `prepareStep` and `onStepFinish`:
   - Show the signature of each
   - Example: using `prepareStep` to trim old messages when `steps` shows token count is high
   - Example: using `onStepFinish` to log each step's token usage

   c. **Controlled stopping** subsection — document `stopWhen`:
   - Show `stopWhen: stepCountIs(10)` example (importing from `'ai'`)

   d. **Provider options** paragraph — note that `providerOptions` set on a `ModelProfile` is automatically threaded through to every `generateText` call for that profile; no per-call override needed

   e. **Retry control** subsection — document `isRetryable`, `onRetry`, `backoffMs`:
   - Show signatures
   - Example: retrying on HTTP 429 using `isRetryable`
   - Note: timeout errors are always retried without consulting `isRetryable`

   f. **Tool timeout** paragraph — document `toolTimeoutMs`:
   - Explain that tool calls can take much longer than model inference
   - Note it reverts to `requestTimeoutMs` for the next model step

   g. **Tools as a closure** paragraph — add to the existing "Tools and progressive discovery" section:
   - Show the closure form alongside the existing array form
   - Note the closure is evaluated once per `send()` call

   h. **Bug fix note** (inline, not a major section) — remove any documentation that implies `maxOutputTokens` is set to the context window size; let the model default speak for itself

3. Verify all type names referenced in the README are exported from `src/index.ts`. Add any missing exports (e.g. if `StepResult` or `StopCondition` are expected to be re-exported for caller use — only add if callers actually need to import them by name).

4. Run `npm run format && npm test` one final time.

---

## Progress

### Completed

- Research and planning
- Phase 1: Fix `maxOutputTokens` bug
- Phase 2: AI SDK pass-throughs
- Phase 3: Retry surface

### In Progress

- (nothing yet)

### To Do

- Phase 4: Signature change + `toolTimeoutMs` + lazy tools
- Phase 5: Versioning & README

## Technical Notes

- `onStepFinish` is **always** a composed function — the internal `resetTimeout()` must fire even when no external `onStepFinish` is provided. The wrapper is unconditional; the external callback is optional.
- `isRetryable` is only called for non-timeout errors. A timeout always retries if attempts remain.
- The lazy tools closure is called once before the retry loop, not once per attempt. This means the tool list is stable across retries of the same `send()` call.
- `toolTimeoutMs` is detected by checking `step.toolCalls.length > 0` on the completed step result. The timer is reset _during_ `onStepFinish` — i.e., at the end of a step, before the next one begins.
- `CoreMessage` (from the AI SDK) is the correct message type for the new signature. `ModelMessage` (from `@ai-sdk/provider-utils`) was the old type. Both are structurally compatible for the `role`/`content` shape, but `CoreMessage` is the richer union type used directly by `generateText`.
- `maxOutputTokens` fix: simply removing the line is correct. `generateText` has its own per-model defaults and there is no `maxOutputTokens` on `ModelProfile` or `SessionOptions` yet. If a caller ever needs to cap output tokens, a new optional field can be added at that time.

## Files Modified/Created

### Services / Core

- `src/session/send.ts` — main change target; all phases touch this file
- `src/session/types.ts` — `SessionOptions` additions across phases 1–4; `SendResult.messages` type change in phase 4
- `src/session/discover-tools.ts` — parameter type update in phase 4 if needed

### Tests

- `tests/session/send.test.ts` — new tests per phase; 19 call sites updated in phase 4
- `tests/integration/runner.test.ts` — 8 call sites updated in phase 4

### Versioning / Docs

- `package.json` — version bump to `0.3.0` in phase 5
- `README.md` — documentation updates in phase 5

## Questions/Decisions Needed

- [ ] Should the `prepareStep` callback receive the raw `CoreMessage[]` that will be sent, or the `updatedMessages` array ref (which is mutable)? Proposal: pass the array by value (spread copy) so the callback cannot mutate it in place — it must return a new array via `{ messages }`.
- [ ] Should `onRetry` be allowed to throw to abort the retry loop early? Proposal: yes — if it throws, the error propagates and the loop exits.

## Decisions Made

- **`onStepFinish` ordering**: `resetTimeout()` fires first, then the external callback. This ensures the timeout window is always reset regardless of whether the external callback throws.
- **`backoffMs` default**: 1000ms flat (matches current behaviour).
- **Lazy tools call timing**: once before the retry loop, not per-step and not per-attempt.
- **`isRetryable` scope**: non-timeout errors only. Timeouts always retry without consulting the predicate.
- **`maxOutputTokens` fix**: remove the line; do not replace with a profile field now.
- **Version**: 0.3.0 (breaking signature change in item 8 warrants a minor bump).

## Session History

### Session 1

- Reviewed existing `send()` implementation via five parallel sub-agent research passes
- Confirmed `maxOutputTokens` bug at line 68 of `send.ts`
- Confirmed `providerOptions` already exists on `ModelProfile` — no new type field needed
- Confirmed 19 unit test call sites and 8 integration test call sites need signature migration
- Confirmed `onStepFinish` internal callback currently does only `resetTimeout()` — must be preserved in composition
- Wrote full phased implementation plan into this feature doc
