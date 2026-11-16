import type { HoldingInput } from './holding'
import type { Quote } from './quote'
import type { IndustryWeight } from './industry'
export interface HoldingSnapshot {
  input: HoldingInput; quote: Quote | null; marketValue: number; pnl: number
  pnlPercent: number | null; weight: number
}
export interface ConcentrationMetrics {
  top1: number; top3: number; top5: number; hhi: number; effectiveN: number
  level: '分散' | '适中' | '集中' | '高度集中'
}
export interface PortfolioSnapshot {
  totalMarketValue: number; totalCost: number; totalPnl: number; totalPnlPercent: number | null
  todayPnl: number; todayPnlPercent: number | null; holdings: HoldingSnapshot[]
  concentration: ConcentrationMetrics; industryWeights: IndustryWeight[]; missingCount: number
}
