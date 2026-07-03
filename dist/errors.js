export class RequestTimeoutError extends Error {
  constructor(retries) {
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
export class ProviderUnavailableError extends Error {
  constructor(message) {
    super(message)
    this.name = 'ProviderUnavailableError'
  }
}
