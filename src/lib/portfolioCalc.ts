import type { HoldingInput } from '../types/holding'
import type { Quote } from '../types/quote'
import type { HoldingSnapshot, PortfolioSnapshot } from '../types/portfolio'
import type { IndustryWeight } from '../types/industry'
import { calcConcentration } from './concentration'
import { getIndustry } from '../services/industryService'
export function calcHoldingSnapshot(input:HoldingInput,quote:Quote|null):HoldingSnapshot {
  const cost=input.quantity*input.costPrice
  const marketValue=quote?quote.price*input.quantity:cost
  const pnl=marketValue-cost
  return {input,quote,marketValue,pnl,pnlPercent:cost>0?pnl/cost:null,weight:0}
}
export function calcPortfolioSnapshot(holdings:HoldingInput[],quotes:Map<string,Quote>):PortfolioSnapshot {
  const snaps=holdings.map(h=>calcHoldingSnapshot(h,quotes.get(h.code)??null))
  const totalMarketValue=snaps.reduce((s,h)=>s+h.marketValue,0)
  const totalCost=snaps.reduce((s,h)=>s+h.input.quantity*h.input.costPrice,0)
  const todayPnl=snaps.reduce((s,h)=>s+(h.quote?(h.quote.price-h.quote.yesterday)*h.input.quantity:0),0)
  const yesterdayValue=snaps.reduce((s,h)=>s+(h.quote?h.quote.yesterday*h.input.quantity:h.marketValue),0)
  const industries=new Map<string,IndustryWeight>()
  for(const h of snaps){
    h.weight=totalMarketValue>0?h.marketValue/totalMarketValue:0
    const name=getIndustry(h.input)
    const item=industries.get(name)??{name,marketValue:0,weight:0,count:0}
    item.marketValue+=h.marketValue;item.weight+=h.weight;item.count++;industries.set(name,item)
  }
  const totalPnl=totalMarketValue-totalCost
  return {totalMarketValue,totalCost,totalPnl,totalPnlPercent:totalCost>0?totalPnl/totalCost:null,
    todayPnl,todayPnlPercent:yesterdayValue>0?todayPnl/yesterdayValue:null,holdings:snaps,
    concentration:calcConcentration(snaps.map(h=>h.weight)),industryWeights:[...industries.values()].sort((a,b)=>b.weight-a.weight),
    missingCount:snaps.filter(h=>!h.quote).length}
}
