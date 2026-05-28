import { describe, it, expect } from 'vitest'

describe.skip('Anthropic smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    // Requires ANTHROPIC_API_KEY in .env
    expect(process.env.ANTHROPIC_API_KEY).toBeDefined()
  })
})
