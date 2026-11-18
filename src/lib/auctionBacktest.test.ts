import { describe, expect, it } from 'vitest'
import { auctionDemo } from './auction'
import { DEFAULT_BACKTEST_SETTINGS, backtestTemplate, parseBacktestArchive, runAuctionBacktest } from './auctionBacktest'
import type { BacktestArchive, BacktestBar, BacktestCoverage, BacktestResult } from '../types/auctionBacktest'

const dates = ['2026-11-12', '2026-11-13', '2026-11-16']
const calendar: BacktestCoverage = { startDate: dates[0], endDate: dates[2], previousTradeDate: '2026-11-11', sessions: dates, fetchedAt: '', source: 'test', historicalAuctionAvailable: false, missing: [], explanation: '' }
const bar = (close = 10.5): BacktestBar => ({ code: 'SZ000001', close, limitUp: 12, limitDown: 9, suspended: false, corporateAction: false, firstTrade: { time: '09:30:00', price: 10.5, volume: 1_000_000 } })
function fixture(): BacktestArchive {
  const record = { ...auctionDemo().records[0], limitUpPrice: 12, price091500: 12 }
  return { schemaVersion: 1, kind: 'auction-backtest', source: '受控测试', scope: '测试完整候选池', days: dates.map((date, i) => ({ date, previousTradeDate: i ? dates[i - 1] : '2026-11-11', poolComplete: true, historicalNames: true, candidates: i === 0 ? [record] : [], bars: [bar(i === 1 ? 11 : 10.5)] })) }
}
const free = { ...DEFAULT_BACKTEST_SETTINGS, initialCapital: 100000, dailyAllocationPercent: 50, commissionBps: 0, minimumCommission: 0, stampTaxBps: 0, transferBps: 0, slippageBps: 0, participationPercent: 100 }
const complete = (archive = fixture(), settings = free) => {
  const result = runAuctionBacktest(archive, calendar, settings)
  expect(result.status).toBe('complete')
  return result as BacktestResult
}

describe('竞价回测', () => {
  it('T+1 按次一交易日收盘卖出，股数整百且资金与逐笔盈亏一致', () => {
    const result = complete()
    expect(result.trades[0]).toMatchObject({ buyDate: dates[0], buyTime: '09:30:00', sellDate: dates[1], buyPrice: 10.5, sellPrice: 11, quantity: 4700, pnl: 2350, status: 'closed' })
    expect(result.totalPnl).toBe(2350)
    expect(result.curve[0].equity).toBe(100000)
    expect(result.curve[1].equity).toBe(102350)
    expect(result.closedPnl + result.openPnl).toBe(result.totalPnl)
    expect(result.winRate).toBe(100)
  })
  it('默认买卖滑点、逐笔最低佣金、过户费、卖出印花税均扣除', () => {
    const settings = { ...DEFAULT_BACKTEST_SETTINGS, initialCapital: 100000 }
    const result = complete(fixture(), settings), trade = result.trades[0]
    // 10.5 * 1.001 rounds upward to 10.52; 11 * .999 rounds down to 10.98.
    expect(trade.buyPrice).toBe(10.52); expect(trade.sellPrice).toBe(10.98)
    expect(trade.quantity).toBe(4700)
    // buy: 12.36 + .49 = 12.85; sell: 12.90 + .52 + 25.80 = 39.22.
    expect(trade.buyFees).toBe(12.85); expect(trade.sellFees).toBe(39.22)
    expect(result.totalFees).toBe(52.07); expect(result.totalPnl).toBe(2109.93)
    expect(result.closedPnl + result.openPnl).toBeCloseTo(result.totalPnl, 2)
    const small = complete(fixture(), { ...settings, initialCapital: 5000 })
    expect(small.trades[0].buyFees).toBe(5.02)
  })
  it('最大回撤按日收盘峰值计算，包含初始本金', () => {
    const data = fixture()
    data.days[0].bars[0].close = 11.5
    data.days[1].bars[0].close = 9.5
    const result = complete(data)
    expect(result.curve.map(row => row.equity)).toEqual([104700, 95300, 95300])
    expect(result.maxDrawdownPercent).toBeCloseTo(9400 / 104700 * 100)
    const feesOnly = fixture()
    feesOnly.days.forEach(day => { day.bars[0].close = 10.5 })
    expect(complete(feesOnly, { ...free, minimumCommission: 5 }).maxDrawdownPercent).toBe(0.01)
  })
  it('停牌或跌停延后卖出，期末持仓按收盘估值，未实现不算胜率', () => {
    const data = fixture()
    data.days[1].bars[0].close = 9
    data.days[2].bars[0].suspended = true
    data.days[2].bars[0].firstTrade = null
    const result = complete(data)
    expect(result.trades[0].sellDate).toBeNull(); expect(result.trades[0].status).toBe('open')
    expect(result.winRate).toBeNull(); expect(result.closedPnl).toBe(0)
    expect(result.openPnl).toBe(result.totalPnl)
    data.days[2].bars[0].suspended = false
    expect(complete(data).trades[0].sellDate).toBe(dates[2])
  })
  it('未来卖出资金不用于当日早盘买入，按已知代码顺序分配', () => {
    const data = fixture()
    data.days[1].candidates = [{ ...data.days[0].candidates[0], code: 'SH600000' }]
    data.days[1].bars.push({ ...bar(), code: 'SH600000' })
    data.days[2].bars.push({ ...bar(), code: 'SH600000' })
    const result = complete(data, { ...free, dailyAllocationPercent: 100 })
    expect(result.trades[0].quantity).toBe(9500)
    expect(result.trades).toHaveLength(1)
    expect(result.skipped[0].reason).toContain('可用资金')
    expect(result.curve.every(row => row.cash >= 0)).toBe(true)
  })
  it('首笔涨停跳过，成交量参与上限控制仓位', () => {
    const data = fixture()
    data.days[0].bars[0].firstTrade!.price = 12
    expect(complete(data).trades).toHaveLength(0)
    expect(complete(data).skipped[0].reason).toContain('涨停')
    data.days[0].bars[0].firstTrade!.price = 10.5
    data.days[0].bars[0].firstTrade!.volume = 2500
    expect(complete(data, { ...free, participationPercent: 10 }).trades[0].quantity).toBe(200)
  })
  it('复用严格竞价条件，创业板、ST、负涨幅均排除', () => {
    const data = fixture(), base = data.days[0].candidates[0]
    data.days[0].candidates = [{ ...base, code: 'SZ300001' }, { ...base, name: '*ST测试' }, { ...base, code: 'SZ000002', price092500: 9.9, price092457: 9.8 }]
    expect(complete(data).signals).toBe(0)
  })
  it('缺少交易日、关键竞价时点或未确认完整候选池会阻止整个收益报告', () => {
    const data = fixture()
    data.days.pop()
    expect(runAuctionBacktest(data, calendar, free)).toMatchObject({ status: 'blocked', coveredDays: 2 })
    const missing = fixture()
    missing.days[0].candidates[0].price092457 = null
    expect(runAuctionBacktest(missing, calendar, free).status).toBe('blocked')
    const template = backtestTemplate(calendar)
    expect(runAuctionBacktest(template, calendar, free)).toMatchObject({ status: 'blocked', coveredDays: 0 })
  })
  it('缺估值、除权分红或竞价与执行日期价格不一致时阻止报告', () => {
    for (const change of [(data: BacktestArchive) => { data.days[1].bars = [] }, (data: BacktestArchive) => { data.days[1].bars[0].corporateAction = true }, (data: BacktestArchive) => { data.days[0].bars[0].limitUp = 11.99 }]) {
      const data = fixture(); change(data)
      expect(runAuctionBacktest(data, calendar, free).status).toBe('blocked')
    }
  })
  it('完整空候选池是零交易；缺失日不是零收益', () => {
    const data = fixture(); data.days.forEach(day => { day.candidates = []; day.bars = [] })
    const result = complete(data)
    expect(result.totalPnl).toBe(0); expect(result.winRate).toBeNull()
    expect(result.curve).toHaveLength(3)
  })
  it('历史档案校验拒绝竞价成交冒充连续分笔、重复日、缺布尔标记、非元价格', () => {
    expect(parseBacktestArchive(JSON.stringify(fixture()))).toEqual(fixture())
    const cases = [
      (data: BacktestArchive) => { data.days[0].bars[0].firstTrade!.time = '09:25:00' },
      (data: BacktestArchive) => { data.days.push(data.days[0]) },
      (data: BacktestArchive) => { data.days[0].bars[0].close = 10.501 },
      (data: BacktestArchive) => { delete (data.days[0] as Partial<typeof data.days[0]>).historicalNames },
      (data: BacktestArchive) => { data.days[0].bars[0].suspended = true },
    ]
    for (const change of cases) { const data = fixture(); change(data); expect(() => parseBacktestArchive(JSON.stringify(data))).toThrow() }
    expect(() => complete(fixture(), { ...free, initialCapital: NaN })).toThrow()
  })
})
