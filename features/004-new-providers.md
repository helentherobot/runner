# New Providers

- Branch: `feature/004-new-providers`

## Overview

Helen currently supports Anthropic, OpenAI, OpenRouter, Google, and Ollama as model providers. Adding DeepSeek and LM Studio expands the set of usable models — DeepSeek for cheap, high-quality cloud inference and LM Studio for fully local inference without requiring a separate Ollama install.

Progressive tool discovery is the current default: tools are withheld from the model and revealed only when their keywords appear in the conversation. This helps small or confused models, but it breaks prompt caching (the system prompt changes every turn as new tools are unlocked) and adds unnecessary friction for capable models. A per-call toggle makes the trade-off explicit and opt-outable.

### Background / Current Behavior

- **Current behavior**: Five providers are supported (Anthropic, OpenAI, OpenRouter, Google, Ollama). All sessions use progressive tool discovery — tools are filtered each turn via keyword matching in `discoverTools()`.
- **Problem**: No path to use DeepSeek or LM Studio models. Progressive discovery cannot be disabled even for capable models where it hurts caching with no benefit.
- **Where it happens**: `src/providers/`, `src/providers/registry.ts`, `src/session/send.ts`, `src/session/discover-tools.ts`
- **Impact**: Limits available models; makes prompt caching unreliable for capable-model sessions.

### Target Outcome

This feature adds DeepSeek and LM Studio as first-class providers and introduces a `progressiveToolDiscovery` flag on `SessionOptions` so that callers can:

- Use `provider: 'deepseek'` with `deepseek-v4-flash` or `deepseek-v4-pro`
- Use `provider: 'lm-studio'` with any locally-loaded model, configuring the base URL per-call
- Set `progressiveToolDiscovery: false` to pass all tools upfront and keep the system prompt stable across turns

## Requirements

### Functional

- [ ] `DeepSeekProvider` resolves via `provider: 'deepseek'` in the registry; uses `@ai-sdk/openai` with `baseURL: 'https://api.deepseek.com'`
- [ ] `DEEPSEEK_API_KEY` is read from environment and wired through `ResolvedSecrets.deepSeek`
- [ ] `LmStudioProvider` resolves via `provider: 'lm-studio'`; baseURL defaults to `http://localhost:1234/v1` but is configurable via `ResolvedSecrets.lmStudioBaseUrl`
- [ ] `progressiveToolDiscovery: false` on `SessionOptions` causes all tools to be passed on every turn without keyword filtering
- [ ] `progressiveToolDiscovery` defaults to `true`; all existing behaviour is unchanged when the flag is absent

### Non-Functional

- [ ] Observability: no new logging required beyond what exists
- [ ] Performance: no new dependencies; `@ai-sdk/openai` already installed
- [ ] Backwards compatibility: additive only — no existing provider, secret, or session API changes break
- [ ] LM Studio smoke test excluded from CI (requires local server); DeepSeek smoke test requires `DEEPSEEK_API_KEY`

### Out of Scope

- DeepSeek thinking mode (follow-up feature)
- Multi-instance LM Studio (registry caches by provider key; different base URLs on the same key are not supported this iteration)
- Migrating existing profiles to set `progressiveToolDiscovery`

## Implementation Plan

> **Code style**: No useless comments. Only add comments that explain tricky/non-obvious code.
> **Before committing**: Run `npm run format` and `npm test` before every commit.
> **No auto-committing**: Only commit when explicitly asked.
> **One step at a time**: Complete only the current step before proceeding.

---

### Phase 1 — DeepSeek Provider

#### Step 1.1 — Add `deepSeek` to `ResolvedSecrets`

File: `src/types.ts`

- Locate the `ResolvedSecrets` interface (contains `openAi?`, `google?`, `anthropic?`, etc.)
- Add: `deepSeek?: string`
- Map it from `process.env.DEEPSEEK_API_KEY` in the secrets resolver (wherever the other env vars are read — same file or `src/runner.ts`)

#### Step 1.2 — Create `src/providers/deepseek.ts`

Model exactly on `src/providers/openai.ts`:

```typescript
import { createOpenAI } from '@ai-sdk/openai'
import type { Provider } from './types.js'

export class DeepSeekProvider implements Provider {
  readonly #client: ReturnType<typeof createOpenAI>

  constructor(apiKey: string, deps?: { client?: ReturnType<typeof createOpenAI> }) {
    this.#client =
      deps?.client ??
      createOpenAI({
        apiKey,
        baseURL: 'https://api.deepseek.com',
      })
  }

  model(key: string) {
    return this.#client(key)
  }
}
```

#### Step 1.3 — Register in `src/providers/registry.ts`

- Import `DeepSeekProvider` from `./deepseek.js`
- Add to the `switch` in `#createProvider`:
  ```typescript
  case 'deepseek':
    return new DeepSeekProvider(secrets.deepSeek ?? '')
  ```

#### Step 1.4 — Unit test: `tests/providers/deepseek.test.ts`

Mirror `tests/providers/openai.test.ts` exactly:

- Create a mock client via `deps`
- Call `provider.model('deepseek-v4-flash')`
- Assert the mock was invoked with that key
- Assert the constructor passed `baseURL: 'https://api.deepseek.com'` to `createOpenAI`

#### Step 1.5 — Registry test additions in `tests/providers/registry.test.ts`

- Add `vi.mock('../src/providers/deepseek.js')` at the top alongside the other mocks
- Import `DeepSeekProvider`
- Add `deepSeek: 'ds-key'` to `baseConfig.secrets`
- Add test: `'passes deepSeek secret to DeepSeekProvider'` — verifies the constructor was called with `'ds-key'`

#### Step 1.6 — Smoke test: `tests/smoke/deepseek.smoke.ts`

Mirror `tests/smoke/openai.smoke.ts`:

- Create a `Runner` with `provider: 'deepseek'`, `model: 'deepseek-v4-flash'`, `secrets: { deepSeek: process.env.DEEPSEEK_API_KEY }`
- Run a trivial prompt (`"Say hello."`)
- Assert response text is non-empty and `inputTokens > 0`
- The smoke suite is run via `npm run test:smoke` with `--env-file .env`; add `DEEPSEEK_API_KEY=sk-...` to `.env` locally

---

### Phase 2 — LM Studio Provider

#### Step 2.1 — Add `lmStudioBaseUrl` to `ResolvedSecrets`

File: `src/types.ts`

- Add: `lmStudioBaseUrl?: string` to `ResolvedSecrets`
- This is not a secret in the traditional sense, but threading it through `ResolvedSecrets` is the lowest-friction path given the registry only receives `key` and `secrets` in `#createProvider`
- Map from `process.env.LM_STUDIO_BASE_URL` (or accept it directly when the runner is configured programmatically)

#### Step 2.2 — Create `src/providers/lm-studio.ts`

```typescript
import { createOpenAI } from '@ai-sdk/openai'
import type { Provider } from './types.js'

const DEFAULT_BASE_URL = 'http://localhost:1234/v1'

export class LmStudioProvider implements Provider {
  readonly #client: ReturnType<typeof createOpenAI>

  constructor(baseURL = DEFAULT_BASE_URL, deps?: { client?: ReturnType<typeof createOpenAI> }) {
    this.#client =
      deps?.client ??
      createOpenAI({
        apiKey: 'lm-studio', // LM Studio ignores the API key; placeholder required by the SDK
        baseURL,
      })
  }

  model(key: string) {
    return this.#client(key)
  }
}
```

#### Step 2.3 — Register in `src/providers/registry.ts`

- Import `LmStudioProvider` from `./lm-studio.js`
- Add to the `switch` in `#createProvider`:
  ```typescript
  case 'lm-studio':
    return new LmStudioProvider(secrets.lmStudioBaseUrl)
  ```
  (Constructor defaults to `http://localhost:1234/v1` when the arg is `undefined`)

#### Step 2.4 — Unit test: `tests/providers/lm-studio.test.ts`

- Verify `model()` delegates to injected client
- Verify that when no baseURL is provided, the default `http://localhost:1234/v1` is used
- Verify that a custom baseURL is passed through to `createOpenAI`
- Verify the placeholder API key `'lm-studio'` is used (not `undefined`)

#### Step 2.5 — Registry test additions in `tests/providers/registry.test.ts`

- Add `vi.mock('../src/providers/lm-studio.js')` at the top
- Import `LmStudioProvider`
- Add test: `'passes lmStudioBaseUrl to LmStudioProvider'` — verifies constructor called with the value from secrets
- Add test: `'uses default baseURL when lmStudioBaseUrl is absent'` — verifies constructor called with `undefined` (triggering the default in the provider)

#### Step 2.6 — No CI smoke test

- LM Studio requires a running local server; it cannot run in CI
- Add a comment in `tests/smoke/` (or a `lm-studio.smoke.ts` with `.skip`) documenting the manual test steps:
  1. Start LM Studio, load a model, start the local server on port 1234
  2. Run `LM_STUDIO_BASE_URL=http://localhost:1234/v1 npm run test:smoke -- lm-studio`

---

### Phase 3 — Progressive Tool Discovery Toggle

#### Step 3.1 — Add flag to `ModelProfile` and `SessionOptions`

File: `src/types.ts`

- Add to `ModelProfile`:
  ```typescript
  progressiveToolDiscovery?: boolean
  ```

File: `src/session/types.ts`

- Add to `SessionOptions`:

  ```typescript
  progressiveToolDiscovery?: boolean
  ```

- Default is `true` in both places (preserve existing behaviour for all callers that don't set it)
- Add a JSDoc comment explaining the trade-off: `false` passes all tools every turn and keeps the system prompt stable (better for prompt caching); `true` (default) filters by keywords each turn
- The Runner should map `profile.progressiveToolDiscovery` → `sessionOptions.progressiveToolDiscovery` when building session options from a profile; `SessionOptions` can still override it at call time

#### Step 3.2 — Branch in `buildToolSet` in `src/session/send.ts`

The `buildToolSet(msgs)` closure currently always calls `discoverTools(msgs, toolsArray)`. Change it to:

```typescript
const buildToolSet = (msgs: CoreMessage[]) => {
  const toolsArray = typeof options.tools === 'function' ? options.tools() : (options.tools ?? [])
  if (options.progressiveToolDiscovery === false) {
    return toolsArray
  }
  return discoverTools(msgs, toolsArray)
}
```

This single branch handles both the initial tool set (line ~67) and the `prepareStep` re-evaluation (lines ~70–73), since both go through `buildToolSet`.

Note: `discoverTools` itself does not change. Tools without keywords are always included regardless; the flag only controls whether keyword-gated tools are filtered.

#### Step 3.3 — Tests in `tests/session/send.test.ts`

Existing tests at lines 123–158 cover the progressive (default) path. Add new test cases under a `describe('progressiveToolDiscovery: false', ...)` block:

- **All tools passed upfront**: create a session with `progressiveToolDiscovery: false` and tools that have keywords; assert all tools are present in the first `generateText` call even when no keywords appear in messages
- **Static array**: verify the full tool array is passed as-is
- **Closure tools**: verify the closure is still called (so dynamic restrictions work), but the result is not filtered by keywords
- **Per-step (prepareStep)**: verify that on subsequent steps, all tools are still passed without keyword filtering

---

## Progress

### Completed

- Worktree created, feature doc initialised
- Phase 1: DeepSeek provider
- Phase 2: LM Studio provider
- Phase 3: Progressive tool discovery toggle

### In Progress

_(none)_

### Blocked

_(none)_

### To Do

_(none)_

## Technical Notes

**Why `lmStudioBaseUrl` lives in `ResolvedSecrets`**: The provider registry's `#createProvider` only receives the provider key and the `ResolvedSecrets` object. Passing the base URL through secrets is the least-invasive approach. A future refactor could pass a partial profile instead, which would be architecturally cleaner but requires changing more call sites.

**Registry caching with LM Studio**: The registry caches provider instances by key string (`#providers` Map). Two profiles with different `lmStudioBaseUrl` values would get the same first-constructed instance. This is acceptable for the current scope.

**No keyword injection in system prompt**: Despite the original brief mentioning "keyword injection in system prompt", this does not exist in the codebase. Progressive tool discovery is purely a runtime filter in `discoverTools()` — no system prompt modification is involved. The `progressiveToolDiscovery: false` flag therefore only needs to bypass `discoverTools()`.

**`progressiveToolDiscovery` lives on both `ModelProfile` and `SessionOptions`**: Adding it to `ModelProfile` means the Runner can map it automatically — no manual wiring per call site. `SessionOptions` still accepts it for callers that want to override at call time. `ModelProfile` is the "set and forget" path; `SessionOptions` is the escape hatch.

**Ollama is currently broken** (`ollama-ai-provider@1.2.0` targets `LanguageModelV1`, but `ai@6` requires `LanguageModelV3`). LM Studio avoids this entirely by using `@ai-sdk/openai` directly — no new package, no version mismatch.

## Files Modified/Created

### Providers

- `src/providers/deepseek.ts` — new DeepSeek provider
- `src/providers/lm-studio.ts` — new LM Studio provider
- `src/providers/registry.ts` — add `case 'deepseek'` and `case 'lm-studio'`

### Types / Config

- `src/types.ts` — add `deepSeek?` and `lmStudioBaseUrl?` to `ResolvedSecrets`; add `progressiveToolDiscovery?` to `ModelProfile`

### Session

- `src/session/types.ts` — add `progressiveToolDiscovery?: boolean` to `SessionOptions`
- `src/session/send.ts` — branch in `buildToolSet` to skip `discoverTools` when flag is false

### Tests

- `tests/providers/deepseek.test.ts` — new unit test
- `tests/providers/lm-studio.test.ts` — new unit test
- `tests/providers/registry.test.ts` — extend with DeepSeek and LM Studio cases
- `tests/smoke/deepseek.smoke.ts` — smoke test against `deepseek-v4-flash`
- `tests/smoke/lm-studio.smoke.ts` — skipped; manual test steps documented
- `tests/session/send.test.ts` — new cases for `progressiveToolDiscovery: false`

## Testing

⬜ **Not started**: No tests written yet.

## Questions/Decisions Needed

_(none)_

## Decisions Made

- `lmStudioBaseUrl` threaded through `ResolvedSecrets` (not profile config) to avoid refactoring the registry's `#createProvider` signature
- `progressiveToolDiscovery` on **both** `ModelProfile` and `SessionOptions` — Runner reads it from the profile and maps it to session options automatically; callers can still override it on `SessionOptions` directly
- No system prompt changes needed for the discovery toggle (keyword filtering lives entirely in `discoverTools()`)

## Session History

### Session 1

- Worktree created, feature doc initialised

### Session 2

- Research sub-agents run for all three phases; full implementation plan written to feature doc
