import { describe, it, expect } from 'vitest'
import { makeTailDemo, reviewComplete, tailPhase } from './tailSelection'

describe('尾盘观察时间与证据边界', () => {
  it('以北京时间严格区分筛选、观察和结束，不受本机时区影响', () => {
    expect(tailPhase(Date.parse('2026-11-20T06:29:00Z')).stage).toBe(0)
    expect(tailPhase(Date.parse('2026-11-20T06:30:00Z')).stage).toBe(1)
    expect(tailPhase(Date.parse('2026-11-20T06:50:00Z')).stage).toBe(2)
    expect(tailPhase(Date.parse('2026-11-20T06:58:00Z')).stage).toBe(3)
    expect(tailPhase(Date.parse('2026-11-21T06:50:00Z')).stage).toBe(-1)
  })
  it('缺项和失败不会变成人工复核完成', () => {
    expect(reviewComplete([])).toBe(false)
    expect(reviewComplete(['pass'])).toBe(false)
    expect(reviewComplete(['pass', 'pass', 'pass', 'pass', 'pending'])).toBe(false)
    expect(reviewComplete(['pass', 'pass', 'pass', 'pass', 'fail'])).toBe(false)
    expect(reviewComplete(['pass', 'pass', 'pass', 'pass', 'pass'])).toBe(true)
  })
  it('演示明确保留标记且漏斗与候选一致', () => {
    const demo = makeTailDemo()
    expect(demo.demo).toBe(true)
    expect(demo.stale).toBe(true)
    expect(demo.candidates.filter(stock => stock.gates.every(Boolean))).toHaveLength(demo.stages[4])
  })
})
