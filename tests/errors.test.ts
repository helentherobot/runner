import { describe, it, expect } from 'vitest'
import { RequestTimeoutError, RequestCancelledError } from '../src/index.js'

describe('RequestTimeoutError', () => {
  it('is an instance of Error', () => {
    expect(new RequestTimeoutError(3)).toBeInstanceOf(Error)
  })

  it('has the correct name', () => {
    expect(new RequestTimeoutError(3).name).toBe('RequestTimeoutError')
  })

  it('includes the retry count in the message (plural)', () => {
    expect(new RequestTimeoutError(3).message).toBe('Request timed out after 3 retries')
  })

  it('uses singular "retry" when retries is 1', () => {
    expect(new RequestTimeoutError(1).message).toBe('Request timed out after 1 retry')
  })
})

describe('RequestCancelledError', () => {
  it('is an instance of Error', () => {
    expect(new RequestCancelledError()).toBeInstanceOf(Error)
  })

  it('has the correct name', () => {
    expect(new RequestCancelledError().name).toBe('RequestCancelledError')
  })

  it('has the correct message', () => {
    expect(new RequestCancelledError().message).toBe('Request was cancelled')
  })
})
