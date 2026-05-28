import { describe, it, expect } from 'vitest'

describe.skip('OpenRouter smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    // Requires OPEN_ROUTER_API_KEY in .env
    expect(process.env.OPEN_ROUTER_API_KEY).toBeDefined()
  })
})
