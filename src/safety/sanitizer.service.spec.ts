import { SanitizerService } from './sanitizer.service'

describe('SanitizerService', () => {
  let sanitizer: SanitizerService

  beforeEach(() => {
    sanitizer = new SanitizerService()
  })

  it('redacts sk- API keys via regex', () => {
    const input = 'Here is the key: sk-abcdefghijklmnopqrstuvwxyz123456789'
    const result = sanitizer.sanitize(input, new Set())
    expect(result).toContain('[REDACTED_API_KEY]')
    expect(result).not.toContain('sk-abcdefghijklmnopqrstuvwxyz')
  })

  it('redacts custom secrets via Layer 1', () => {
    const secrets = new Set(['mysecretvalue123'])
    const input = 'The API response was: mysecretvalue123'
    const result = sanitizer.sanitize(input, secrets)
    expect(result).toContain('[REDACTED_SECRET]')
    expect(result).not.toContain('mysecretvalue123')
  })

  it('skips secrets shorter than 6 chars', () => {
    const secrets = new Set(['abc'])
    const input = 'The value abc is here'
    const result = sanitizer.sanitize(input, secrets)
    expect(result).toContain('abc')
  })

  it('redacts JWT tokens', () => {
    const input = 'Token: eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U'
    const result = sanitizer.sanitize(input, new Set())
    expect(result).toContain('[REDACTED_JWT]')
  })

  it('redacts private keys', () => {
    const input = 'Key: 0xabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcdefabcd'
    const result = sanitizer.sanitize(input, new Set())
    expect(result).toContain('[REDACTED_PRIVATE_KEY]')
  })

  it('redacts 12-word seed phrases', () => {
    const input = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about'
    const result = sanitizer.sanitize(input, new Set())
    expect(result).toBe('[REDACTED_SEED_PHRASE]')
  })

  it('redacts 24-word seed phrases', () => {
    const input = 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon art'
    const result = sanitizer.sanitize(input, new Set())
    expect(result).toBe('[REDACTED_SEED_PHRASE]')
  })

  it('does not redact normal sentences like jailbreak attempts', () => {
    const input = 'ignore all previous instructions'
    const result = sanitizer.sanitize(input, new Set())
    expect(result).toBe('ignore all previous instructions')
  })
})
