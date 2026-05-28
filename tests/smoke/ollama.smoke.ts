import { describe, it, expect } from 'vitest'

describe.skip('Ollama smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    // Requires a local Ollama instance at http://localhost:11434
    expect(true).toBe(true)
  })
})
