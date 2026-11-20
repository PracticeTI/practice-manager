/** An error that maps directly onto an HTTP response from a route handler. */
export class QueueError extends Error {
  constructor(message, status = 400, code = 'invalid_request') {
    super(message)
    this.name = 'QueueError'
    this.status = status
    this.code = code
  }
}
