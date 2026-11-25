import { parseAuctionDataset, screenAuction } from './auction'
import type { AuctionDataset, AuctionRecord, AuctionRules } from '../types/auction'

const KEY = 'a-share-auction-matches-v1'
export interface AuctionMatchMemory {
  tradeDate: string
  previousTradeDate: string
  rules: AuctionRules
  records: AuctionRecord[]
}
const sameScope = (memory: AuctionMatchMemory, dataset: AuctionDataset, rules: AuctionRules) =>
  memory.tradeDate === dataset.tradeDate && memory.previousTradeDate === dataset.previousTradeDate &&
  memory.rules.volumePercent === rules.volumePercent && memory.rules.amountYuan === rules.amountYuan

export function readAuctionMatches(): AuctionMatchMemory | null {
  try {
    const text = localStorage.getItem(KEY)
    if (!text || text.length > 5 * 1024 * 1024) return null
    const raw = JSON.parse(text)
    if (raw.schemaVersion !== 1 || !raw.rules || !Array.isArray(raw.records) || raw.records.length > 500) return null
    const dataset = parseAuctionDataset(JSON.stringify({ ...raw, source: '已保存的竞价入选', records: raw.records }))
    if (dataset.demo) return null
    const records = dataset.records.filter(record => record.retainedMatch && screenAuction(record, raw.rules).status === 'matched')
    return { tradeDate: dataset.tradeDate, previousTradeDate: dataset.previousTradeDate, rules: raw.rules, records }
  } catch { return null }
}

export function saveAuctionMatches(memory: AuctionMatchMemory) {
  localStorage.setItem(KEY, JSON.stringify({ schemaVersion: 1, ...memory }))
}
export function clearAuctionMatches() { localStorage.removeItem(KEY) }

export function restoreAuctionMatches(memory: AuctionMatchMemory | null): AuctionDataset | null {
  if (!memory?.records.length) return null
  const asOf = memory.records.at(-1)!.retainedMatch!.matchedAt
  return {
    schemaVersion: 1, tradeDate: memory.tradeDate, previousTradeDate: memory.previousTradeDate,
    source: '浏览器保存的竞价入选', records: memory.records,
    automatic: { fetchedAt: asOf, asOf, isToday: memory.tradeDate === new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date()),
      stale: true, poolCount: 0, scannedCount: 0, incompleteCount: 0, warnings: ['已恢复上次入选快照，等待本次行情更新。'] },
  }
}

// Keep whole snapshots that passed together; never manufacture a match by mixing fields from different requests.
export function retainAuctionMatches(snapshot: AuctionDataset | null, rules: AuctionRules, previous: AuctionMatchMemory | null) {
  if (!snapshot?.automatic || snapshot.demo) return { dataset: snapshot, memory: previous }
  const compatible = previous && sameScope(previous, snapshot, rules) ? previous : null
  const saved = new Map(compatible?.records.filter(record => screenAuction(record, rules).status === 'matched').map(record => [record.code, record]))
  const visible = new Map(snapshot.records.map(record => [record.code, record]))
  for (const record of snapshot.records) {
    if (screenAuction(record, rules).status !== 'matched') continue
    saved.set(record.code, { ...record, retainedMatch: record.retainedMatch ?? {
      matchedAt: snapshot.automatic.asOf, source: snapshot.source,
    } })
  }
  for (const [code, record] of saved) {
    const current = visible.get(code)
    if (!current || screenAuction(current, rules).status !== 'matched') visible.set(code, record)
  }
  const records = [...saved.values()]
  const memory = compatible && JSON.stringify(records) === JSON.stringify(compatible.records) ? compatible : {
    tradeDate: snapshot.tradeDate, previousTradeDate: snapshot.previousTradeDate, rules: { ...rules }, records,
  }
  return { dataset: { ...snapshot, records: [...visible.values()] }, memory }
}
