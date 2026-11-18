import type { AuctionRecord, AuctionRules } from './auction'

export interface BacktestCoverage {
  startDate: string
  endDate: string
  previousTradeDate: string
  sessions: string[]
  fetchedAt: string
  source: string
  historicalAuctionAvailable: false
  missing: string[]
  explanation: string
}
export interface BacktestBar {
  code: string
  close: number
  limitUp: number
  limitDown: number
  suspended: boolean
  corporateAction: boolean
  // First executable continuous-session trade, in China time; volume in shares.
  firstTrade: { time: string; price: number; volume: number } | null
}
export interface BacktestDay {
  date: string
  previousTradeDate: string
  poolComplete: boolean
  historicalNames: boolean
  candidates: AuctionRecord[]
  bars: BacktestBar[]
}
export interface BacktestArchive {
  schemaVersion: 1
  kind: 'auction-backtest'
  source: string
  scope: string
  demo?: true
  days: BacktestDay[]
}
export interface BacktestSettings {
  initialCapital: number
  dailyAllocationPercent: number
  maxDailyStocks: number
  commissionBps: number
  minimumCommission: number
  stampTaxBps: number
  transferBps: number
  slippageBps: number
  participationPercent: number
}
export interface BacktestTrade {
  code: string
  name: string
  buyDate: string
  buyTime: string
  buyPrice: number
  quantity: number
  buyFees: number
  sellDate: string | null
  sellPrice: number | null
  sellFees: number
  pnl: number
  returnPercent: number
  markPrice: number
  status: 'closed' | 'open'
}
export interface BacktestPoint { date: string; equity: number; cash: number; drawdownPercent: number }
export interface BacktestResult {
  status: 'complete'
  settings: BacktestSettings
  rules: AuctionRules
  curve: BacktestPoint[]
  trades: BacktestTrade[]
  skipped: { date: string; code: string; reason: string }[]
  totalPnl: number
  returnPercent: number
  maxDrawdownPercent: number
  winRate: number | null
  totalFees: number
  closedPnl: number
  openPnl: number
  signals: number
}
export type BacktestOutcome = BacktestResult | { status: 'blocked'; gaps: string[]; coveredDays: number; requiredDays: number }
