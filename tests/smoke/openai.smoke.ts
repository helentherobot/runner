import { describe, it, expect } from 'vitest'

describe.skip('OpenAI smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    // Requires OPENAI_API_KEY in .env
    expect(process.env.OPENAI_API_KEY).toBeDefined()
  })
})
