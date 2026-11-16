export interface Quote {
  code: string
  name: string
  price: number
  percent: number
  low: number
  high: number
  yesterday: number
  source: 'tencent' | 'sina' | 'eastmoney' | 'demo'
}
