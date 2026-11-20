export interface TailStock {
  code: string; name: string; price: number | null; change: number | null; amount: number | null
  turnover: number | null; volumeRatio: number | null; floatCap: number | null
  high: number | null; low: number | null; industry: string; asOf: string; gates: (boolean | null)[]
}
export interface TailSnapshot {
  market: 'main' | 'all'
  asOf: string; fetchedAt: string; marketDate: string; isToday: boolean; stale: boolean; demo: boolean
  indices: {code: string; name: string; price: number | null; change: number | null; asOf: string | null}[]
  candidates: TailStock[]; stages: number[]; scannedCount: number; total: number; pages: number
  scope: string; warnings: string[]; source: {name: string; url: string}
}
