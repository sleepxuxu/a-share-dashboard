import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auctionDemo, DEFAULT_AUCTION_RULES, parseAuctionDataset } from './auction'
import { clearAuctionMatches, readAuctionMatches, restoreAuctionMatches, retainAuctionMatches, saveAuctionMatches } from './auctionRetention'
import type { AuctionDataset } from '../types/auction'

const snapshot = (): AuctionDataset => ({ ...auctionDemo(), demo: undefined, records: [auctionDemo().records[0]], automatic: {
  fetchedAt: '2026-11-18T02:00:00Z', asOf: '2026-11-18T02:00:00Z', isToday: true, stale: false,
  poolCount: 1, scannedCount: 1, incompleteCount: 0, warnings: [],
} })
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', {
    getItem: (key: string) => store.get(key) ?? null,
    setItem: (key: string, value: string) => { store.set(key, value) },
    removeItem: (key: string) => { store.delete(key) },
  })
})
afterEach(() => vi.unstubAllGlobals())

describe('竞价曾入选记录保留', () => {
  it('新最低额规则重新校验旧保留，移除不足1000万元的旧入选但保留其他有效股票', () => {
    const data = snapshot(), first = retainAuctionMatches(data, DEFAULT_AUCTION_RULES, null)
    const valid = first.memory!.records[0]
    const memory = { ...first.memory!, records: [valid, { ...valid, code: 'SH600000', auctionAmount: 9_999_999 }] }
    saveAuctionMatches(memory)
    expect(readAuctionMatches()!.records.map(record => record.code)).toEqual([valid.code])
    const next = retainAuctionMatches({ ...data, records: [] }, DEFAULT_AUCTION_RULES, memory)
    expect(next.dataset!.records.map(record => record.code)).toEqual([valid.code])
    expect(next.memory!.records).toHaveLength(1)
  })
  it('后续缺失、失败或整股消失都保留当时全部通过的完整证据', () => {
    const data = snapshot(), first = retainAuctionMatches(data, DEFAULT_AUCTION_RULES, null)
    for (const records of [[{ ...data.records[0], price091500: null }], [{ ...data.records[0], price092500: 9.9 }], []]) {
      const next = retainAuctionMatches({ ...data, records }, DEFAULT_AUCTION_RULES, first.memory)
      expect(next.dataset!.records).toHaveLength(1)
      expect(next.dataset!.records[0]).toMatchObject({ price091500: 11, price092500: 10.5, retainedMatch: { matchedAt: data.automatic!.asOf, source: data.source } })
      expect(next.memory).toBe(first.memory)
    }
  })
  it('继续添加新入选，当前再次通过时显示新完整快照并去掉保留提示', () => {
    const data = snapshot(), first = retainAuctionMatches(data, DEFAULT_AUCTION_RULES, null)
    const records = [{ ...data.records[0], price092500: 10.6 }, { ...data.records[0], code: 'SH600000' }]
    const next = retainAuctionMatches({ ...data, records }, DEFAULT_AUCTION_RULES, first.memory)
    expect(next.memory!.records).toHaveLength(2)
    expect(next.dataset!.records[0].price092500).toBe(10.6)
    expect(next.dataset!.records[0].retainedMatch).toBeUndefined()
  })
  it('不拼接两次各自未通过的字段来虚构入选', () => {
    const data = snapshot()
    const first = retainAuctionMatches({ ...data, records: [{ ...data.records[0], price092500: null }] }, DEFAULT_AUCTION_RULES, null)
    const next = retainAuctionMatches({ ...data, records: [{ ...data.records[0], price091500: null }] }, DEFAULT_AUCTION_RULES, first.memory)
    expect(next.memory!.records).toEqual([])
    expect(next.dataset!.records[0].price091500).toBeNull()
  })
  it('跨交易日、前一交易日或阈值不沿用，演示与导入独立', () => {
    const data = snapshot(), first = retainAuctionMatches(data, DEFAULT_AUCTION_RULES, null)
    const empty = { ...data, records: [] }
    for (const next of [{ ...empty, tradeDate: '2026-11-19' }, { ...empty, previousTradeDate: '2026-11-16' }]) {
      expect(retainAuctionMatches(next, DEFAULT_AUCTION_RULES, first.memory).dataset!.records).toEqual([])
    }
    expect(retainAuctionMatches(empty, { volumePercent: 5, amountYuan: 1e8 }, first.memory).dataset!.records).toEqual([])
    for (const next of [{ ...empty, demo: true as const }, { ...empty, automatic: undefined }]) {
      expect(retainAuctionMatches(next, DEFAULT_AUCTION_RULES, first.memory).dataset!.records).toEqual([])
    }
  })
  it('浏览器保存后可恢复，导入导出保留来源时间，明确清空可删除', () => {
    const data = snapshot(), first = retainAuctionMatches(data, DEFAULT_AUCTION_RULES, null)
    saveAuctionMatches(first.memory!)
    const restored = readAuctionMatches()
    expect(restoreAuctionMatches(restored)).toMatchObject({ automatic: { stale: true }, records: [expect.objectContaining({ retainedMatch: first.memory!.records[0].retainedMatch })] })
    const next = retainAuctionMatches({ ...data, records: [] }, DEFAULT_AUCTION_RULES, restored)
    expect(next.dataset!.records[0].retainedMatch).toEqual(first.memory!.records[0].retainedMatch)
    const imported = parseAuctionDataset(JSON.stringify(next.dataset))
    expect(imported.records[0].retainedMatch).toEqual(first.memory!.records[0].retainedMatch)
    expect(() => parseAuctionDataset(JSON.stringify({ ...next.dataset, tradeDate: '2026-11-19' }))).toThrow('retainedMatch')
    clearAuctionMatches()
    expect(readAuctionMatches()).toBeNull()
  })
})
