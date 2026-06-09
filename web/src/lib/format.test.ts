import { describe, it, expect } from 'vitest'
import { fmtDuration, fmtBytes, fmtNum, fmtPct, relTime } from './format'

describe('fmtDuration', () => {
  it('renders an em-dash for zero or negative input', () => {
    expect(fmtDuration(0)).toBe('—')
    expect(fmtDuration(-5)).toBe('—')
  })
  it('formats sub-minute durations with seconds', () => {
    expect(fmtDuration(0.5)).toBe('0.50s')
    expect(fmtDuration(12.3)).toBe('12.3s')
  })
  it('formats minutes and hours', () => {
    expect(fmtDuration(90)).toBe('1m 30s')
    expect(fmtDuration(3 * 3600 + 5 * 60)).toBe('3h 5m')
  })
})

describe('fmtBytes', () => {
  it('returns em-dash for null', () => {
    expect(fmtBytes(undefined)).toBe('—')
  })
  it('scales through units', () => {
    expect(fmtBytes(512)).toBe('512 B')
    expect(fmtBytes(2048)).toBe('2.0 KB')
    expect(fmtBytes(5 * 1024 * 1024)).toBe('5.0 MB')
  })
})

describe('fmtNum', () => {
  it('returns em-dash for non-finite', () => {
    expect(fmtNum(null)).toBe('—')
    expect(fmtNum(Number.NaN)).toBe('—')
  })
  it('trims trailing zeros and uses exponent at the extremes', () => {
    expect(fmtNum(0)).toBe('0')
    expect(fmtNum(0.123400)).toBe('0.1234')
    expect(fmtNum(12345)).toBe('1.23e+4')
    expect(fmtNum(0.0001)).toBe('1.00e-4')
  })
})

describe('fmtPct', () => {
  it('formats fractions as percentages', () => {
    expect(fmtPct(0.985)).toBe('98.5%')
    expect(fmtPct(undefined)).toBe('—')
  })
})

describe('relTime', () => {
  it('returns em-dash when missing', () => {
    expect(relTime(null)).toBe('—')
  })
  it('reports just now for recent timestamps', () => {
    expect(relTime(new Date().toISOString())).toBe('just now')
  })
  it('reports hours ago', () => {
    const threeHoursAgo = new Date(Date.now() - 3 * 3600 * 1000).toISOString()
    expect(relTime(threeHoursAgo)).toBe('3h ago')
  })
})
