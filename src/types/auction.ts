export interface AuctionRecord {
  code: string
  name: string
  previousClose: number | null
  previousLimitUpPrice: number | null
  previousLimitUpVerified?: boolean
  previousVolume: number | null
  limitUpPrice: number | null
  price091500: number | null
  price091501?: number | null
  price091502?: number | null
  price092457: number | null
  price092458?: number | null
  price092459?: number | null
  price092500: number | null
  auctionTime?: string
  auctionVolume: number | null
  auctionAmount: number | null
  quoteAsOf?: string
  dataWarnings?: string[]
  retainedMatch?: { matchedAt: string; source: string }
}

export interface AuctionDataset {
  schemaVersion: 1
  demo?: true
  tradeDate: string
  previousTradeDate: string
  source: string
  records: AuctionRecord[]
  automatic?: {
    fetchedAt: string
    asOf: string
    isToday: boolean
    stale: boolean
    poolCount: number
    scannedCount: number
    incompleteCount: number
    candidatePool?: { sourceDate: string; persisted: boolean; reused: boolean; stockCount: number; dailyCount: number }
    diagnostics?: {
      startedAt: string
      durationMs: number
      requestCount: number
      cacheHitCount: number
      referenceMs: number
      calendarMs: number
      poolMs: number
      stocksMs: number
      persistedPool?: boolean
      persistedDailyCount?: number
    }
    warnings: string[]
  }
}

export interface AuctionRules { volumePercent: number; amountYuan: number }
export type CheckStatus = 'pass' | 'fail' | 'missing'
export interface AuctionCheck { label: string; status: CheckStatus; detail: string }
export interface AuctionResult {
  record: AuctionRecord
  checks: AuctionCheck[]
  status: 'matched' | 'rejected' | 'pending'
  volumePercent: number | null
  auctionChangePercent: number | null
}
