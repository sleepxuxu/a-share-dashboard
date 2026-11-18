import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { auctionDemo, DEFAULT_AUCTION_RULES } from './auction'
import { canSaveAutomaticSelection, makeSelectionDay, parseSelections, readSelections, saveSelections, selectionFloatingPnl, selectionPricePnl } from './auctionSelections'
import type { SelectionPerformance } from './auctionSelections'

const dataset = () => ({ ...auctionDemo(), demo: undefined })
const performance: SelectionPerformance = { code: 'SZ000001', tradeDate: '2026-11-17', status: 'complete', entry: { date: '2026-11-17', time: '09:30:00', price: 10.5, volume: 10000 }, exit: { date: '2026-11-18', price: 11 }, nextTradeDate: '2026-11-18', latest: { date: '2026-11-18', price: 11, final: true }, warnings: [], fetchedAt: '', source: 'test' }
beforeEach(() => {
  const store = new Map<string, string>()
  vi.stubGlobal('localStorage', { getItem: (key: string) => store.get(key) ?? null, setItem: (key: string, value: string) => { store.set(key, value) } })
})
afterEach(() => vi.unstubAllGlobals())

describe('已入选名单与后续价格测算', () => {
  it('只保存已经符合条件的股票，含缺失的候选池不宣称完整', () => {
    const selected = makeSelectionDay(dataset(), DEFAULT_AUCTION_RULES)
    expect(selected.stocks.map(row => row.code)).toEqual(['SZ000001', 'SH600000'])
    expect(selected.complete).toBe(false)
    const data = dataset(); data.records = [data.records[0]]
    expect(makeSelectionDay(data, DEFAULT_AUCTION_RULES).complete).toBe(true)
  })
  it('同日同阈值幂等保存，其他阈值隔离，完整记录不被缺失记录覆盖', () => {
    const data = dataset(); data.records = [data.records[0]]
    const day = makeSelectionDay(data, DEFAULT_AUCTION_RULES)
    saveSelections([day]); saveSelections([day])
    expect(readSelections().days).toHaveLength(1)
    saveSelections([{ ...day, complete: false, stocks: [] }])
    expect(readSelections().days[0].stocks).toHaveLength(1)
    saveSelections([{ ...day, rules: { volumePercent: 5, amountYuan: 1e8 } }])
    expect(readSelections().days).toHaveLength(2)
  })
  it('历史入选只需要代码名称日期，不再要求原始竞价报价', () => {
    const archive = parseSelections(JSON.stringify({ schemaVersion: 1, kind: 'auction-selections', days: [{ tradeDate: '2026-11-17', source: '已保存名单', complete: true, rules: DEFAULT_AUCTION_RULES, stocks: [{ code: '002843', name: '泰嘉股份' }] }] }))
    expect(archive.days[0].stocks[0]).toEqual({ code: 'SZ002843', name: '泰嘉股份', limitUpPrice: null })
    const oldExport = { ...dataset(), appliedRules: DEFAULT_AUCTION_RULES, records: [dataset().records[0]] }
    expect(parseSelections(JSON.stringify(oldExport)).days[0].stocks).toHaveLength(1)
    expect(() => parseSelections(JSON.stringify({ ...oldExport, demo: true }))).toThrow('演示')
  })
  it('成熟自动快照才存档，排除过期、错误日期和 09:25 前快照', () => {
    const data = { ...dataset(), automatic: { fetchedAt: '', asOf: '2026-11-18T09:25:00+08:00', isToday: true, stale: false, poolCount: 1, scannedCount: 1, incompleteCount: 0, warnings: [] } }
    expect(canSaveAutomaticSelection(data)).toBe(true)
    for (const asOf of ['2026-11-18T09:24:59+08:00', '2026-11-17T10:00:00+08:00', 'invalid']) expect(canSaveAutomaticSelection({ ...data, automatic: { ...data.automatic, asOf } })).toBe(false)
    expect(canSaveAutomaticSelection({ ...data, demo: true })).toBe(false)
    expect(canSaveAutomaticSelection({ ...data, automatic: { ...data.automatic, stale: true } })).toBe(false)
  })
  it('每100股价格测算计入双边滑点、最低佣金与税费；浮盈亏不提前计未来卖出', () => {
    expect(selectionPricePnl(performance)).toMatchObject({ buy: 10.52, sell: 10.98, fees: 10.57, pnl: 35.43 })
    expect(selectionPricePnl({ ...performance, status: 'waiting_exit', exit: null })).toBeNull()
    const pending = { ...performance, status: 'waiting_exit' as const, entry: { ...performance.entry!, price: 16.77 }, exit: null, latest: { date: '2026-11-18', price: 15.52, final: false } }
    expect(selectionFloatingPnl(pending)?.pnl).toBe(-132.02)
    expect(selectionFloatingPnl(performance)).toBeNull()
  })
  it('拒绝无效日期、重复股票及同日阈值重复，保留完整零入选日', () => {
    const day = makeSelectionDay(dataset(), DEFAULT_AUCTION_RULES)
    const wrap = (days: unknown[]) => JSON.stringify({ schemaVersion: 1, kind: 'auction-selections', days })
    expect(() => parseSelections(wrap([{ ...day, tradeDate: '2026-02-30' }]))).toThrow()
    expect(() => parseSelections(wrap([day, day]))).toThrow()
    expect(() => parseSelections(wrap([{ ...day, stocks: [day.stocks[0], day.stocks[0]] }]))).toThrow()
    expect(parseSelections(wrap([{ ...day, stocks: [], complete: true }])).days[0].complete).toBe(true)
  })
})
