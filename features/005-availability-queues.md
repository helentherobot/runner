# Availability Queues

- Branch: `feature/005-availability-queues`

## Overview

Runner currently treats all configured profiles as permanently available. There's no way to express "try this local model first, fall back to cloud if it's down" — every `send()` call targets exactly one profile. This means local-first inference (e.g. LM Studio Gemma with Haiku fallback) requires the caller to implement retry logic externally.

This feature adds:

- **Availability checks** on profiles — fast-reject before entering the queue
- **Composite profiles** — ordered candidate lists with automatic fallback
- **Anthropic Agent SDK provider** — OAuth-based auth for subscription billing
- **maxOutputTokens passthrough** — small QoL addition

### Target Outcome

Callers can define a composite profile like `"local-first"` that tries LM Studio, then falls back to Anthropic Haiku via subscription billing, with zero caller-side retry logic.

## Implementation Plan

### Phase 1: ProviderUnavailableError & isAvailable

Add the typed error and availability check infrastructure.

**`src/errors.ts`**

- Add `ProviderUnavailableError` class following existing pattern (`RequestTimeoutError`, `RequestCancelledError`). Constructor takes a message string. Sets `this.name`.

**`src/types.ts`**

- Add optional `isAvailable?: () => Promise<boolean>` to `ModelProfile`. Profile-scoped — each profile owns its availability semantics independently of its provider.

**`src/session/send.ts`**

- After profile/provider/queue resolution (line ~23), before `queue.enqueue()` (line ~50): if `profile.isAvailable` is defined, `await` it. If it returns `false`, throw `ProviderUnavailableError`.

**`src/recipes/run-recipe.ts`**

- Same check: after profile resolution, before `queue.enqueue()`. If `isAvailable` returns `false`, throw `ProviderUnavailableError`.

**`src/index.ts`**

- Export `ProviderUnavailableError`.

**Tests**

- `send()` with `isAvailable: () => false` throws `ProviderUnavailableError`
- `send()` with `isAvailable: () => true` proceeds normally
- `send()` with no `isAvailable` proceeds normally (backward compat)
- `runRecipe()` same three cases
- Run `npm test` to confirm nothing breaks

---

### Phase 2: withAvailabilityCache helper

Composable caching wrapper so `isAvailable()` doesn't fire on every call.

**`src/availability.ts`** (new file)

- Export `withAvailabilityCache(fn: () => Promise<boolean>, ttlMs: number): () => Promise<boolean>`
- Returns a wrapper that caches the result for `ttlMs` milliseconds. After TTL expires, the next call re-evaluates.
- Cache stores `{ value: boolean, expiresAt: number }`. Uses `Date.now()` for time (injectable for tests via optional clock param or just testable with fake timers).

**`src/index.ts`**

- Export `withAvailabilityCache`.

**Tests**

- Calls underlying function only once within TTL window
- Re-evaluates after TTL expires
- Handles async errors gracefully (returns `false` on throw, does not cache errors)
- Run `npm test`

---

### Phase 3: Composite Profiles

Virtual profiles that try an ordered list of candidates.

**`src/types.ts`**

- Add `CompositeProfile` type: `{ kind: 'composite'; candidates: string[] }`
- Create union: `type AnyProfile = ModelProfile | CompositeProfile`
- Update `RunnerConfig.profiles` to `Record<string, AnyProfile>`
- `ModelProfile` stays as-is (no `kind` field needed — absence of `kind` or `kind !== 'composite'` means concrete)

**`src/session/send.ts`**

- Add composite resolution: if the resolved profile has `kind === 'composite'`, loop over `candidates`:
  - Look up each candidate in `runner.config.profiles` (must be a concrete `ModelProfile`, not another composite — throw if nested)
  - Run the existing send logic (availability check, queue, generateText) for that candidate
  - On any error (including `ProviderUnavailableError`), catch and continue to next candidate
  - On success, return the result with cost attribution from the winning candidate's profile
  - If all candidates fail, throw a `CompositeExhaustedError` (or rethrow the last error — decision: rethrow last for simplicity)
- **Queue keying**: pass the candidate's profile key to `getQueue`, not the composite key. Each candidate gets its own queue and rate limit.
- **Scope**: pass candidate key as scope fallback, not the composite key

**`src/recipes/run-recipe.ts`**

- Same composite resolution loop wrapping the existing recipe logic

**`src/errors.ts`**

- No new error needed — rethrow last candidate's error on exhaustion

**`src/index.ts`**

- Export `CompositeProfile`, `AnyProfile`

**Tests**

- Composite with first candidate available: uses first, never tries second
- Composite with first unavailable: falls back to second
- Composite with all candidates failing: throws last error
- Composite with nested composite candidate: throws immediately
- `runRecipe()` with composite profile: same fallback behavior
- Run `npm test`

---

### Phase 4: Anthropic Agent SDK Provider

New provider using OAuth Bearer auth via `@ai-sdk/anthropic` authToken option.

**`src/providers/anthropic-agent.ts`** (new file)

- `AnthropicAgentProvider implements Provider`
- Constructor accepts optional `credentialsPath` (default `~/.claude/.credentials.json`)
- Reads file synchronously at construction: `JSON.parse(readFileSync(path, 'utf-8'))`
- Extracts `data.claudeAiOauth.accessToken`
- Throws clear error if file missing or token absent
- Creates client: `createAnthropic({ authToken: token, headers: { 'anthropic-beta': 'oauth-2025-04-20' } })`
- `model(key)` delegates to `this.#client(key)`

**`src/providers/registry.ts`**

- Add `case 'anthropic-agent':` that instantiates `AnthropicAgentProvider` with no secrets (credentials from disk)

**`src/index.ts`**

- Export `AnthropicAgentProvider`

**Tests**

- Provider reads token from credentials file and creates client with authToken
- Provider throws if credentials file missing
- Provider throws if accessToken absent in file
- Registry resolves `'anthropic-agent'` key to the new provider
- Run `npm test`

---

### Phase 5: maxOutputTokens on SessionOptions

**`src/session/types.ts`**

- Add `maxOutputTokens?: number` to `SessionOptions`

**`src/types.ts`**

- Add `maxOutputTokens?: number` to `ModelProfile` (profile-level default)

**`src/session/send.ts`**

- Resolve `maxOutputTokens`: session-level overrides profile-level (same pattern as `maxSteps` on line ~47)
- Pass resolved value as `maxTokens` to `generateText()` call

**Tests**

- `send()` with `maxOutputTokens` in session options passes it to generateText
- Profile-level `maxOutputTokens` used when session-level absent
- Session-level overrides profile-level
- Run `npm test`

## Decisions Made

- **No nested composites**: composite candidates must be concrete profiles. Keeps resolution simple and avoids cycles.
- **Rethrow last error on composite exhaustion**: no new error class needed; the last candidate's error is the most informative.
- **`isAvailable` is profile-scoped, not provider-scoped**: different profiles using the same provider can have different availability semantics.
- **No OAuth refresh flow**: token is read at construction time. Expiry results in API 401; user re-authenticates via `claude` CLI.
- **`withAvailabilityCache` does not cache errors**: a failed check returns `false` but doesn't prevent re-evaluation on the next call.
- **Queue keying uses candidate key, not composite key**: each candidate maintains its own rate limit queue.
