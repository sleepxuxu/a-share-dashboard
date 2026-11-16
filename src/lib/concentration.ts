import type { ConcentrationMetrics } from '../types/portfolio'
import { RISK } from '../constants/riskThresholds'
export function calcConcentration(weights: number[]): ConcentrationMetrics {
  const sorted=weights.filter(w=>Number.isFinite(w)&&w>0).sort((a,b)=>b-a)
  const hhi=sorted.reduce((s,w)=>s+w*w,0)
  // Normalize floating point accumulation at policy boundaries, e.g. ten 10% holdings.
  const stableHhi=Math.round(hhi*1e12)/1e12
  const top=(n:number)=>sorted.slice(0,n).reduce((s,w)=>s+w,0)
  return {top1:top(1),top3:top(3),top5:top(5),hhi,effectiveN:hhi>0?1/hhi:0,
    level:stableHhi<RISK.diversified?'分散':stableHhi<RISK.moderate?'适中':stableHhi<=RISK.concentrated?'集中':'高度集中'}
}
