import { describe, it, expect } from 'vitest'
import { parseHash } from './router'

describe('parseHash', () => {
  it('defaults empty input to the root route', () => {
    expect(parseHash('')).toEqual({ segs: [], query: {}, hash: '/' })
  })

  it('splits path segments and drops empties', () => {
    expect(parseHash('#/runs/run-a1f3').segs).toEqual(['runs', 'run-a1f3'])
  })

  it('decodes query parameters', () => {
    const r = parseHash('#/diff?a=run-1&b=run%202')
    expect(r.segs).toEqual(['diff'])
    expect(r.query).toEqual({ a: 'run-1', b: 'run 2' })
  })
})
