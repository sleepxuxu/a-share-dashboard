export interface FinancialReport {
  period:string
  reportDate:string
  publishedAt:string|null
  revenue:number|null
  revenueGrowth:number|null
  netProfit:number|null
  profitGrowth:number|null
  roe:number|null
  grossMargin:number|null
  netMargin:number|null
  debtRatio:number|null
  eps:number|null
  operatingCashFlow:number|null
}
export interface Fundamentals {
  code:string
  name:string
  fetchedAt:string
  valuation:{peTtm:number|null;pb:number|null;marketCap:number|null}|null
  reports:FinancialReport[]
  warnings:string[]
  sources:{name:string;url:string}[]
}
export type AiProvider='deepseek'|'ark'
export interface AiConfig {providers:{id:AiProvider;name:string;model:string;configured:boolean}[]}
export interface AiAnalysis {content:string;provider:string;model:string;generatedAt:string;reportDate:string}
