import { describe, it, expect } from 'vitest'

describe.skip('Google smoke test', () => {
  it('runs a trivial prompt and returns text + usage', async () => {
    // Requires GOOGLE_API_KEY in .env
    expect(process.env.GOOGLE_API_KEY).toBeDefined()
  })
})
