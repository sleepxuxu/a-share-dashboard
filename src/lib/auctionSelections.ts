import { DEFAULT_AUCTION_RULES, screenAuction } from './auction'
import { normalizeCode } from './normalizeCode'
import type { AuctionDataset, AuctionRules } from '../types/auction'

export interface SelectedStock { code: string; name: string; limitUpPrice: number | null }
export interface SelectionDay {
  tradeDate: string
  source: string
  rules: AuctionRules
  complete: boolean
  stocks: SelectedStock[]
}
export interface SelectionArchive { schemaVersion: 1; kind: 'auction-selections'; days: SelectionDay[] }
export interface SelectionPerformance {
  code: string
  tradeDate: string
  status: 'complete' | 'waiting_entry' | 'waiting_exit' | 'missing'
  entry: { date: string; time: string; price: number; volume: number } | null
  exit: { date: string; price: number } | null
  nextTradeDate: string | null
  latest: { date: string; price: number; final: boolean } | null
  warnings: string[]
  fetchedAt: string
  source: string
}
const KEY = 'a-share-auction-selections-v1'
const validDate = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
export const selectionKey = (day: SelectionDay) => `${day.tradeDate}|${day.rules.volumePercent}|${day.rules.amountYuan}`

export function makeSelectionDay(dataset: AuctionDataset, rules: AuctionRules): SelectionDay {
  const results = dataset.records.map(record => screenAuction(record, rules))
  return { tradeDate: dataset.tradeDate, source: dataset.source, rules: { ...rules }, complete: !results.some(row => row.status === 'pending'), stocks: results.filter(row => row.status === 'matched').map(({ record }) => ({ code: record.code, name: record.name, limitUpPrice: record.limitUpPrice })) }
}
export function canSaveAutomaticSelection(dataset: AuctionDataset): boolean {
  if (dataset.demo || !dataset.automatic || dataset.automatic.stale) return false
  const date = new Date(dataset.automatic.asOf)
  if (!Number.isFinite(date.getTime())) return false
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(date) === dataset.tradeDate && new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(date) >= '09:25:05'
}
export function parseSelections(text: string): SelectionArchive {
  if (text.length > 5 * 1024 * 1024) throw new Error('入选名单不能超过 5 MB。')
  let raw
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('入选名单须为有效 JSON。') }
  // Accept the existing “导出入选” file without asking for historical auction ticks.
  if (raw?.schemaVersion === 1 && Array.isArray(raw.records) && raw.appliedRules) {
    if (raw.demo) throw new Error('演示名单不能用于真实行情回测。')
    raw = { schemaVersion: 1, kind: 'auction-selections', days: [{ tradeDate: raw.tradeDate, source: raw.source, complete: false, rules: raw.appliedRules, stocks: raw.records }] }
  }
  if (raw?.schemaVersion !== 1 || raw.kind !== 'auction-selections' || !Array.isArray(raw.days) || raw.days.length > 400 || raw.demo) throw new Error('请导入入选名单文件，包含 kind: auction-selections 和 days；也支持「导出入选」文件。')
  const seen = new Set<string>()
  const days: SelectionDay[] = raw.days.map((day: Record<string, unknown>) => {
    if (!day || !validDate(day.tradeDate) || typeof day.source !== 'string' || !day.source.trim() || day.source.length > 160 || typeof day.complete !== 'boolean' || !Array.isArray(day.stocks) || day.stocks.length > 500) throw new Error('每个入选日须提供有效日期、来源、complete 标记及 stocks 数组。')
    const rules = day.rules as AuctionRules
    if (!rules || !Number.isFinite(rules.volumePercent) || rules.volumePercent <= 0 || rules.volumePercent > 100 || !Number.isFinite(rules.amountYuan) || rules.amountYuan <= 0 || rules.amountYuan > 1e14) throw new Error('入选名单缺少有效筛选阈值 rules。')
    const codes = new Set<string>()
    const stocks = day.stocks.map((item: unknown): SelectedStock => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('股票记录无效。')
      const row = item as Record<string, unknown>, code = typeof row.code === 'string' ? normalizeCode(row.code) : null
      if (!code || codes.has(code) || typeof row.name !== 'string' || !row.name.trim() || row.name.length > 40) throw new Error('股票代码、名称无效或同一入选日重复。')
      codes.add(code)
      const limit = row.limitUpPrice
      if (limit !== undefined && limit !== null && (typeof limit !== 'number' || !Number.isFinite(limit) || limit <= 0 || limit > 1e6 || Math.abs(limit * 100 - Math.round(limit * 100)) > 1e-6)) throw new Error('涨停价须为元价格，最多两位小数。')
      return { code, name: row.name.trim(), limitUpPrice: typeof limit === 'number' ? limit : null }
    })
    const result = { tradeDate: day.tradeDate, source: day.source.trim(), complete: day.complete, rules: { volumePercent: rules.volumePercent, amountYuan: rules.amountYuan }, stocks }
    if (seen.has(selectionKey(result))) throw new Error('同一日期和筛选阈值的名单重复。')
    seen.add(selectionKey(result)); return result
  })
  return { schemaVersion: 1, kind: 'auction-selections', days: days.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)) }
}
export function readSelections(): SelectionArchive {
  const stored = localStorage.getItem(KEY)
  return stored ? parseSelections(stored) : { schemaVersion: 1, kind: 'auction-selections', days: [] }
}
export function saveSelections(days: SelectionDay[]): SelectionArchive {
  const existing = readSelections(), merged = new Map(existing.days.map(day => [selectionKey(day), day]))
  for (const day of days) {
    const key = selectionKey(day)
    if (merged.get(key)?.complete && !day.complete) continue
    merged.set(key, day)
  }
  const archive = parseSelections(JSON.stringify({ ...existing, days: [...merged.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate)).slice(-400) }))
  localStorage.setItem(KEY, JSON.stringify(archive))
  return archive
}
export function selectionTemplate(): SelectionArchive {
  return { schemaVersion: 1, kind: 'auction-selections', days: [{ tradeDate: '2026-11-17', source: '请填写真实历史入选名单来源', rules: DEFAULT_AUCTION_RULES, complete: false, stocks: [] }] }
}

// A per-trade price benchmark, independent of portfolio cash or overlapping bets.
export function selectionPricePnl(performance: SelectionPerformance, quantity = 100) {
  if (performance.status !== 'complete' || !performance.entry || !performance.exit) return null
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const buy = Math.ceil((performance.entry.price * 1.001 - 1e-8) * 100) / 100
  const sell = Math.floor((performance.exit.price * .999 + 1e-8) * 100) / 100
  const buyAmount = buy * quantity, sellAmount = sell * quantity
  const buyFees = round(Math.max(5, round(buyAmount * .00025)) + round(buyAmount * .00001))
  const sellFees = round(Math.max(5, round(sellAmount * .00025)) + round(sellAmount * .00001) + round(sellAmount * .0005))
  const pnl = round(sellAmount - buyAmount - buyFees - sellFees)
  return { quantity, buy, sell, fees: round(buyFees + sellFees), pnl, returnPercent: pnl / (buyAmount + buyFees) * 100 }
}
export function selectionFloatingPnl(performance: SelectionPerformance, quantity = 100) {
  if (!performance.entry || performance.exit || !performance.latest) return null
  const buy = Math.ceil((performance.entry.price * 1.001 - 1e-8) * 100) / 100
  const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
  const amount = buy * quantity
  const fees = round(Math.max(5, round(amount * .00025)) + round(amount * .00001))
  const pnl = round(performance.latest.price * quantity - amount - fees)
  return { pnl, returnPercent: pnl / (amount + fees) * 100 }
}
