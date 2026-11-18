import { DEFAULT_AUCTION_RULES, parseAuctionDataset, screenAuction } from './auction'
import type { AuctionRules } from '../types/auction'
import type { BacktestArchive, BacktestBar, BacktestCoverage, BacktestOutcome, BacktestPoint, BacktestSettings, BacktestTrade } from '../types/auctionBacktest'

export const DEFAULT_BACKTEST_SETTINGS: BacktestSettings = {
  initialCapital: 1_000_000, dailyAllocationPercent: 50, maxDailyStocks: 5,
  commissionBps: 2.5, minimumCommission: 5, stampTaxBps: 5, transferBps: 0.1,
  slippageBps: 10, participationPercent: 10,
}
const round = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100
const dateValid = (value: unknown): value is string => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const object = (value: unknown): Record<string, unknown> => {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('历史档案包含无效对象。')
  return value as Record<string, unknown>
}
const price = (value: unknown): value is number => typeof value === 'number' && value > 0 && value <= 1e6 && Math.abs(value * 100 - Math.round(value * 100)) < 1e-6
const continuousTime = (value: unknown): value is string => typeof value === 'string' && /^\d{2}:\d{2}:\d{2}$/.test(value) && /:\d[0-9]$/.test(value) && Number(value.slice(3, 5)) < 60 && Number(value.slice(6)) < 60 && ((value >= '09:30:00' && value <= '11:30:00') || (value >= '13:00:00' && value < '14:57:00'))

export function parseBacktestArchive(text: string): BacktestArchive {
  if (text.length > 25 * 1024 * 1024) throw new Error('历史档案不能超过 25 MB。')
  let raw: unknown
  try { raw = JSON.parse(text.replace(/^\uFEFF/, '')) } catch { throw new Error('历史档案不是有效 JSON。') }
  const data = object(raw)
  if (data.schemaVersion !== 1 || data.kind !== 'auction-backtest') throw new Error('请使用回测历史档案模板，不能直接导入单日竞价快照。')
  if (typeof data.source !== 'string' || !data.source.trim() || data.source.length > 160 || typeof data.scope !== 'string' || !data.scope.trim() || data.scope.length > 300) throw new Error('请填写历史来源 source 与候选池范围 scope。')
  if (!Array.isArray(data.days) || !data.days.length || data.days.length > 400) throw new Error('days 须包含 1–400 个交易日。')
  const seen = new Set<string>()
  const days = data.days.map(item => {
    const day = object(item)
    if (!dateValid(day.date) || !dateValid(day.previousTradeDate) || day.previousTradeDate >= day.date || seen.has(day.date)) throw new Error('交易日无效或重复，请检查 date 与 previousTradeDate。')
    seen.add(day.date)
    if (typeof day.poolComplete !== 'boolean' || typeof day.historicalNames !== 'boolean') throw new Error(`${day.date}：须明确完整候选池 poolComplete 与当时名称 historicalNames。`)
    if (!Array.isArray(day.candidates) || day.candidates.length > 6000 || !Array.isArray(day.bars) || day.bars.length > 6000) throw new Error(`${day.date}：candidates 和 bars 须为数组，且各不超过 6000 条。`)
    const candidates = day.candidates.length ? parseAuctionDataset(JSON.stringify({ schemaVersion: 1, tradeDate: day.date, previousTradeDate: day.previousTradeDate, source: data.source, records: day.candidates })).records : []
    const codes = new Set<string>()
    const bars: BacktestBar[] = day.bars.map(item => {
      const bar = object(item)
      if (typeof bar.code !== 'string' || !/^(SH6\d{5}|SZ[03]\d{5})$/.test(bar.code) || codes.has(bar.code)) throw new Error(`${day.date}：行情代码无效或重复。`)
      codes.add(bar.code)
      if (!price(bar.close) || !price(bar.limitUp) || !price(bar.limitDown) || bar.limitDown > bar.close || bar.close > bar.limitUp || typeof bar.suspended !== 'boolean' || typeof bar.corporateAction !== 'boolean') throw new Error(`${day.date} ${bar.code}：须提供未复权收盘、当日涨跌停价、停牌及除权分红标记。`)
      let firstTrade: BacktestBar['firstTrade'] = null
      if (bar.firstTrade !== null && bar.firstTrade !== undefined) {
        const tick = object(bar.firstTrade)
        if (!continuousTime(tick.time) || !price(tick.price) || tick.price < bar.limitDown || tick.price > bar.limitUp || typeof tick.volume !== 'number' || !Number.isSafeInteger(tick.volume) || tick.volume <= 0 || tick.volume > 1e12) throw new Error(`${day.date} ${bar.code}：firstTrade 须为 09:30 后连续交易时段的首个可成交分笔（元、股）。`)
        firstTrade = { time: tick.time, price: tick.price, volume: tick.volume }
      }
      if (bar.suspended && firstTrade) throw new Error(`${day.date} ${bar.code}：停牌日不能同时提供成交分笔。`)
      return { code: bar.code, close: bar.close, limitUp: bar.limitUp, limitDown: bar.limitDown, suspended: bar.suspended, corporateAction: bar.corporateAction, firstTrade }
    })
    return { date: day.date, previousTradeDate: day.previousTradeDate, poolComplete: day.poolComplete, historicalNames: day.historicalNames, candidates, bars }
  }).sort((a, b) => a.date.localeCompare(b.date))
  return { schemaVersion: 1, kind: 'auction-backtest', source: data.source.trim(), scope: data.scope.trim(), ...(data.demo === true ? { demo: true } : {}), days }
}

export function backtestTemplate(calendar: BacktestCoverage): BacktestArchive {
  return { schemaVersion: 1, kind: 'auction-backtest', source: '请填写历史数据供应商', scope: '请填写逐日完整候选池范围（须含退市股票及当时名称）', days: calendar.sessions.map((date, index) => ({ date, previousTradeDate: calendar.sessions[index - 1] ?? calendar.previousTradeDate, poolComplete: false, historicalNames: false, candidates: [], bars: [] })) }
}

function validateSettings(settings: BacktestSettings) {
  for (const [key, value] of Object.entries(settings)) if (!Number.isFinite(value) || value < 0) throw new Error(`参数 ${key} 无效。`)
  if (settings.initialCapital < 1000 || settings.initialCapital > 1e10 || settings.dailyAllocationPercent <= 0 || settings.dailyAllocationPercent > 100 || !Number.isInteger(settings.maxDailyStocks) || settings.maxDailyStocks < 1 || settings.maxDailyStocks > 100 || settings.participationPercent <= 0 || settings.participationPercent > 100 || settings.minimumCommission > 10000 || [settings.commissionBps, settings.stampTaxBps, settings.transferBps, settings.slippageBps].some(value => value > 1000)) throw new Error('本金、仓位、持股数量或费用参数超出范围。')
}

export function runAuctionBacktest(archive: BacktestArchive, calendar: BacktestCoverage, settings = DEFAULT_BACKTEST_SETTINGS, rules: AuctionRules = DEFAULT_AUCTION_RULES): BacktestOutcome {
  validateSettings(settings)
  if (!calendar.sessions.length || new Set(calendar.sessions).size !== calendar.sessions.length || calendar.sessions.some((date, i) => !dateValid(date) || i > 0 && date <= calendar.sessions[i - 1]) || calendar.sessions.at(-1) !== calendar.endDate || !dateValid(calendar.previousTradeDate) || calendar.previousTradeDate >= calendar.sessions[0]) throw new Error('交易日历无效，请重新读取。')
  const gaps: string[] = [], byDate = new Map(archive.days.map(day => [day.date, day]))
  let coveredDays = 0
  for (const [index, date] of calendar.sessions.entries()) {
    const day = byDate.get(date)
    if (!day) { gaps.push(`${date} 缺少历史竞价档案`); continue }
    let complete = true
    if (day.previousTradeDate !== (calendar.sessions[index - 1] ?? calendar.previousTradeDate)) { gaps.push(`${date} 前一交易日与日历不符`); complete = false }
    if (!day.poolComplete || !day.historicalNames) { gaps.push(`${date} 未确认完整候选池或当时 ST 名称`); complete = false }
    const pending = day.candidates.filter(record => screenAuction(record, rules).status === 'pending')
    if (pending.length) { gaps.push(`${date} ${pending.length} 只候选缺少关键竞价字段（如 ${pending[0].code}）`); complete = false }
    if (complete) coveredDays++
  }
  const blocked = (): BacktestOutcome => ({ status: 'blocked', gaps, coveredDays, requiredDays: calendar.sessions.length })
  if (gaps.length) return blocked()

  let cash = round(settings.initialCapital), priorEquity = cash, peak = cash, signals = 0, totalFees = 0
  const trades: BacktestTrade[] = [], curve: BacktestPoint[] = [], skipped: { date: string; code: string; reason: string }[] = []
  const positions = new Map<string, BacktestTrade>()
  const fees = (amount: number, sell: boolean) => round(Math.max(settings.minimumCommission, round(amount * settings.commissionBps / 10000)) + round(amount * settings.transferBps / 10000) + (sell ? round(amount * settings.stampTaxBps / 10000) : 0))
  for (const date of calendar.sessions) {
    const day = byDate.get(date)!, bars = new Map(day.bars.map(bar => [bar.code, bar]))
    // Rank solely by code, fixed before continuous trading; never use future returns.
    const candidates = day.candidates.filter(record => screenAuction(record, rules).status === 'matched').sort((a, b) => a.code.localeCompare(b.code))
    signals += candidates.length
    for (const code of new Set([...positions.keys(), ...candidates.map(row => row.code)])) {
      const bar = bars.get(code)
      if (!bar) gaps.push(`${date} ${code} 缺少成交与收盘估值行情`)
      else if (bar.corporateAction) gaps.push(`${date} ${code} 发生除权分红，须先接入股数及现金权益处理`)
      else if (candidates.some(row => row.code === code) && !bar.suspended && !bar.firstTrade) gaps.push(`${date} ${code} 缺少 09:30 后首笔可成交分笔`)
      const candidate = candidates.find(row => row.code === code)
      if (bar && candidate?.limitUpPrice !== undefined && candidate?.limitUpPrice !== null && Math.round(bar.limitUp * 100) !== Math.round(candidate.limitUpPrice * 100)) gaps.push(`${date} ${code} 竞价与执行行情涨停价不一致`)
    }
    if (gaps.length) return blocked()
    const newCandidates = candidates.filter(row => !positions.has(row.code)).slice(0, settings.maxDailyStocks)
    const budget = Math.min(cash, priorEquity * settings.dailyAllocationPercent / 100)
    const perStock = newCandidates.length ? budget / newCandidates.length : 0
    for (const record of candidates) {
      const skip = (reason: string) => { skipped.push({ date, code: record.code, reason }) }
      if (positions.has(record.code)) { skip('已有持仓，避免重复建仓'); continue }
      if (!newCandidates.includes(record)) { skip('超过每日新买股票数，按代码升序取前 N 只'); continue }
      const bar = bars.get(record.code)!, tick = bar.firstTrade
      if (bar.suspended || !tick) { skip('停牌或没有可成交分笔'); continue }
      const buyPrice = Math.ceil((tick.price * (1 + settings.slippageBps / 10000) - 1e-8) * 100) / 100
      if (tick.price >= bar.limitUp || buyPrice > bar.limitUp) { skip('首笔涨停或加滑点后超涨停价，保守按未成交处理'); continue }
      const allocation = Math.min(perStock, cash)
      let quantity = Math.floor(Math.min(allocation / buyPrice, tick.volume * settings.participationPercent / 100) / 100) * 100
      const minimumLot = record.code.startsWith('SH688') ? 200 : 100
      while (quantity >= minimumLot && round(quantity * buyPrice + fees(quantity * buyPrice, false)) > allocation) quantity -= 100
      if (quantity < minimumLot) { skip('可用资金或首笔成交参与量不足最小买入数量'); continue }
      const buyFees = fees(quantity * buyPrice, false)
      const trade: BacktestTrade = { code: record.code, name: record.name, buyDate: date, buyTime: tick.time, buyPrice, quantity, buyFees, sellDate: null, sellPrice: null, sellFees: 0, pnl: 0, returnPercent: 0, markPrice: bar.close, status: 'open' }
      cash = round(cash - quantity * buyPrice - buyFees); totalFees = round(totalFees + buyFees)
      positions.set(record.code, trade); trades.push(trade)
    }
    // Sells occur after this morning's buys, so afternoon proceeds cannot fund them.
    for (const [code, trade] of positions) {
      const bar = bars.get(code)!
      trade.markPrice = bar.close
      if (trade.buyDate < date && !bar.suspended && bar.close > bar.limitDown) {
        const sellPrice = Math.max(bar.limitDown, Math.floor((bar.close * (1 - settings.slippageBps / 10000) + 1e-8) * 100) / 100)
        const sellFees = fees(sellPrice * trade.quantity, true)
        Object.assign(trade, { sellPrice, sellFees, sellDate: date, status: 'closed' })
        cash = round(cash + sellPrice * trade.quantity - sellFees); totalFees = round(totalFees + sellFees)
        positions.delete(code)
      }
      trade.pnl = round(((trade.sellPrice ?? trade.markPrice) - trade.buyPrice) * trade.quantity - trade.buyFees - trade.sellFees)
      trade.returnPercent = trade.pnl / (trade.buyPrice * trade.quantity + trade.buyFees) * 100
    }
    const equity = round(cash + [...positions.values()].reduce((sum, trade) => sum + trade.quantity * trade.markPrice, 0))
    peak = Math.max(peak, equity)
    curve.push({ date, equity, cash, drawdownPercent: (peak - equity) / peak * 100 })
    priorEquity = equity
  }
  const closed = trades.filter(trade => trade.status === 'closed')
  const totalPnl = round(curve.at(-1)!.equity - settings.initialCapital)
  return { status: 'complete', settings: { ...settings }, rules: { ...rules }, curve, trades, skipped, totalPnl, returnPercent: totalPnl / settings.initialCapital * 100, maxDrawdownPercent: Math.max(...curve.map(point => point.drawdownPercent)), winRate: closed.length ? closed.filter(trade => trade.pnl > 0).length / closed.length * 100 : null, totalFees, closedPnl: round(closed.reduce((sum, trade) => sum + trade.pnl, 0)), openPnl: round(trades.filter(trade => trade.status === 'open').reduce((sum, trade) => sum + trade.pnl, 0)), signals }
}
