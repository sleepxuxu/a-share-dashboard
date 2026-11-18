import type { AuctionDataset, AuctionRecord, AuctionResult, AuctionRules, CheckStatus } from '../types/auction'
import { normalizeCode } from './normalizeCode'

export const DEFAULT_AUCTION_RULES: AuctionRules = { volumePercent: 3, amountYuan: 100_000_000 }
const prices = ['previousClose', 'previousLimitUpPrice', 'limitUpPrice', 'price091500', 'price092457', 'price092500'] as const
const fields = [...prices, 'previousVolume', 'auctionVolume', 'auctionAmount'] as const
const cents = (value: number) => Math.round(value * 100)
const money = (value: number | null) => value === null ? '缺失' : `${value.toFixed(2)} 元`
const compare = (a: number | null, b: number | null, predicate: (a: number, b: number) => boolean): CheckStatus =>
  a === null || b === null ? 'missing' : predicate(a, b) ? 'pass' : 'fail'

export function screenAuction(record: AuctionRecord, rules = DEFAULT_AUCTION_RULES): AuctionResult {
  if (!Number.isFinite(rules.volumePercent) || rules.volumePercent <= 0 || rules.volumePercent > 100 ||
      !Number.isFinite(rules.amountYuan) || rules.amountYuan <= 0) throw new Error('请填写有效的竞价量与成交额阈值。')
  const volumePercent = record.previousVolume !== null && record.previousVolume > 0 && record.auctionVolume !== null
    ? record.auctionVolume / record.previousVolume * 100 : null
  // Compare volumes directly so equality at the threshold never passes through floating point division.
  const volumeStatus: CheckStatus = volumePercent === null ? 'missing'
    : record.auctionVolume! * 100 > record.previousVolume! * rules.volumePercent ? 'pass' : 'fail'
  const amountStatus: CheckStatus = record.auctionAmount === null ? 'missing' : record.auctionAmount > rules.amountYuan ? 'pass' : 'fail'
  const liquidityStatus: CheckStatus = volumeStatus === 'pass' || amountStatus === 'pass' ? 'pass'
    : volumeStatus === 'missing' || amountStatus === 'missing' ? 'missing' : 'fail'
  const excluded = []
  if (/^SZ30\d{4}$/.test(record.code)) excluded.push(`创业板股票（${record.code}）`)
  const riskName = record.name.normalize('NFKC').replace(/\s+/g, '').toUpperCase().replace(/^(XD|XR|DR)/, '')
  if (/^S?\*?ST/.test(riskName)) excluded.push(`ST 风险警示股票（${record.name}）`)
  const auctionChangePercent = record.price092500 !== null && record.previousClose !== null && record.previousClose > 0
    ? (cents(record.price092500) - cents(record.previousClose)) / cents(record.previousClose) * 100 : null
  const checks = [
    { label: '昨日收盘涨停', status: record.previousLimitUpVerified === true ? 'pass' : compare(record.previousClose, record.previousLimitUpPrice, (a, b) => cents(a) === cents(b)),
      detail: record.previousLimitUpVerified === true ? `东方财富前一交易日涨停池确认；前一交易日收盘 ${money(record.previousClose)}` : `前一交易日收盘 ${money(record.previousClose)} / 当日涨停价 ${money(record.previousLimitUpPrice)}` },
    { label: '09:15 涨停价开竞价', status: compare(record.price091500, record.limitUpPrice, (a, b) => cents(a) === cents(b)),
      detail: `09:15:00 ${money(record.price091500)} / 今日涨停价 ${money(record.limitUpPrice)}` },
    { label: '竞价尾段价格抬升', status: compare(record.price092500, record.price092457, (a, b) => cents(a) > cents(b)),
      detail: `09:25:00 ${money(record.price092500)} > 09:24:57 ${money(record.price092457)}` },
    { label: '竞价放量或成交额达标', status: liquidityStatus,
      detail: `竞价量 / 昨日全天量 ${volumePercent === null ? '缺失' : `${volumePercent.toFixed(2)}%`}（须 > ${rules.volumePercent}%）；竞价成交额 ${record.auctionAmount === null ? '缺失' : `${(record.auctionAmount / 1e8).toFixed(4)} 亿元`}（须 > ${rules.amountYuan / 1e8} 亿元），满足任一项` },
    { label: '排除创业板与 ST', status: excluded.length ? 'fail' as const : 'pass' as const,
      detail: excluded.length ? `排除：${excluded.join('、')}` : '非创业板股票，名称未带 ST、*ST 等风险警示标识' },
    { label: '09:25 竞价涨幅非负', status: auctionChangePercent === null ? 'missing' as const : auctionChangePercent < 0 ? 'fail' as const : 'pass' as const,
      detail: `09:25 最终竞价价 ${money(record.price092500)} / 昨收 ${money(record.previousClose)}；竞价涨幅 ${auctionChangePercent === null ? '缺失' : `${auctionChangePercent.toFixed(2)}%`}，须 ≥ 0%（平开保留）` },
  ]
  return { record, checks, volumePercent, auctionChangePercent, status: checks.some(check => check.status === 'fail') ? 'rejected'
    : checks.some(check => check.status === 'missing') ? 'pending' : 'matched' }
}

function validDate(value: unknown): value is string {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
    && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
}

export function parseAuctionDataset(text: string): AuctionDataset {
  let raw: unknown
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('JSON 格式无效，请使用下载的快照模板。') }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('请导入包含日期、来源和 records 的完整快照。')
  const data = raw as Record<string, unknown>
  if (data.schemaVersion !== 1) throw new Error('快照 schemaVersion 必须为 1。')
  if (!validDate(data.tradeDate) || !validDate(data.previousTradeDate) || data.previousTradeDate >= data.tradeDate)
    throw new Error('请填写有效的交易日期和前一交易日，前一交易日须早于交易日期。')
  if (typeof data.source !== 'string' || !data.source.trim() || data.source.length > 160) throw new Error('请填写快照来源（最多 160 字）。')
  if (!Array.isArray(data.records) || !data.records.length || data.records.length > 6000) throw new Error('records 须包含 1–6000 条股票快照。')
  const seen = new Set<string>()
  const records = data.records.map((item: unknown, index: number): AuctionRecord => {
    const prefix = `第 ${index + 1} 条：`
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error(`${prefix}股票快照格式无效。`)
    const row = item as Record<string, unknown>
    const code = typeof row.code === 'string' ? normalizeCode(row.code) : null
    if (!code) throw new Error(`${prefix}仅支持沪深 A 股代码。`)
    if (seen.has(code)) throw new Error(`${prefix}${code} 重复，请先合并。`)
    seen.add(code)
    if (typeof row.name !== 'string' || !row.name.trim() || row.name.length > 40) throw new Error(`${prefix}股票名称须为 1–40 字。`)
    const values = {} as Pick<AuctionRecord, typeof fields[number]>
    for (const field of fields) {
      const value = row[field]
      if (value === null || value === undefined) { values[field] = null; continue }
      if (typeof value !== 'number' || !Number.isFinite(value) || value < 0 || value > 1e14)
        throw new Error(`${prefix}${field} 须为非负数，缺失请填写 null。`)
      if ((prices as readonly string[]).includes(field) && (value === 0 || value > 1e6 || Math.abs(value * 100 - cents(value)) > 1e-6))
        throw new Error(`${prefix}${field} 须为大于 0、最多两位小数的元价格。`)
      if ((field === 'previousVolume' || field === 'auctionVolume') && !Number.isSafeInteger(value))
        throw new Error(`${prefix}${field} 须为整数股数，请将“手”换算为“股”。`)
      values[field] = value
    }
    for (const [price, limit] of [['previousClose', 'previousLimitUpPrice'], ['price091500', 'limitUpPrice'], ['price092457', 'limitUpPrice'], ['price092500', 'limitUpPrice']] as const) {
      if (values[price] !== null && values[limit] !== null && cents(values[price]!) > cents(values[limit]!))
        throw new Error(`${prefix}${price} 高于对应涨停价，请检查日期和单位。`)
    }
    if(row.previousLimitUpVerified !== undefined && typeof row.previousLimitUpVerified !== 'boolean')throw new Error(`${prefix}previousLimitUpVerified 须为布尔值。`)
    return { code, name: row.name.trim(), ...values, ...(row.previousLimitUpVerified === true ? { previousLimitUpVerified: true } : {}) }
  })
  return { schemaVersion: 1, ...(data.demo === true ? { demo: true as const } : {}), tradeDate: data.tradeDate, previousTradeDate: data.previousTradeDate, source: data.source.trim(), records }
}

export function auctionTemplate(): AuctionDataset {
  return { schemaVersion: 1, tradeDate: '2026-11-18', previousTradeDate: '2026-11-17', source: '请填写数据供应商；价格为北京时间精确时点快照，成交量单位为股，成交额单位为元', records: [{
    code: 'SZ000001', name: '请替换为实际股票', previousClose: null, previousLimitUpPrice: null, previousVolume: null,
    limitUpPrice: null, price091500: null, price092457: null, price092500: null, auctionVolume: null, auctionAmount: null,
  }] }
}

export function auctionDemo(): AuctionDataset {
  const base: AuctionRecord = { code: 'SZ000001', name: '示例甲（虚构）', previousClose: 10, previousLimitUpPrice: 10,
    previousVolume: 100_000_000, limitUpPrice: 11, price091500: 11, price092457: 10.3, price092500: 10.5,
    auctionVolume: 4_000_000, auctionAmount: 42_000_000 }
  return { ...auctionTemplate(), demo: true, source: '固定演示 · 全部为虚构快照，不代表这些代码的实际行情', records: [
    base,
    { ...base, code: 'SH600000', name: '示例乙（虚构）', previousVolume: 1_000_000_000, auctionVolume: 10_000_000, auctionAmount: 105_000_000 },
    { ...base, code: 'SZ000002', name: '示例丙（虚构）', price092500: 10.3 },
    { ...base, code: 'SH600001', name: '示例丁（虚构）', auctionVolume: 3_000_000, auctionAmount: 31_500_000 },
    { ...base, code: 'SZ000004', name: '示例戊（虚构）', price092457: null },
    { ...base, code: 'SH600004', name: '示例己（虚构）', auctionVolume: null, auctionAmount: null },
  ] }
}

export function downloadAuctionJson(value: unknown, filename: string) {
  const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json;charset=utf-8' }))
  const link = document.createElement('a'); link.href = url; link.download = filename; link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
