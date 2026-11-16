import { describe,expect,it } from 'vitest'
import { calcPortfolioSnapshot } from './portfolioCalc'
import { calcConcentration } from './concentration'
import { normalizeCode } from './normalizeCode'
import { parseHoldingsCsv } from './csv'
import type { Quote } from '../types/quote'

const quote=(code:string,price:number,yesterday:number):Quote=>({code,name:code,price,yesterday,percent:(price-yesterday)/yesterday*100,low:price,high:price,source:'tencent'})
describe('组合计算验收',()=>{
  it('两笔持仓的市值、成本、累计与今日盈亏符合手算',()=>{
    const holdings=[{code:'SH600036',quantity:100,costPrice:10},{code:'SZ000333',quantity:200,costPrice:20}]
    const quotes=new Map([['SH600036',quote('SH600036',12,11)],['SZ000333',quote('SZ000333',18,19)]])
    const s=calcPortfolioSnapshot(holdings,quotes)
    expect(s.totalMarketValue).toBe(4800)
    expect(s.totalCost).toBe(5000)
    expect(s.totalPnl).toBe(-200)
    expect(s.totalPnlPercent).toBeCloseTo(-.04)
    expect(s.todayPnl).toBe(-100)
    expect(s.holdings.map(h=>h.weight)).toEqual([.25,.75])
    expect(s.concentration.hhi).toBe(.625)
    expect(s.industryWeights.reduce((n,i)=>n+i.weight,0)).toBe(1)
    expect(holdings[0]).not.toHaveProperty('weight')
  })
  it('行情缺失按成本暂估，不制造亏损',()=>{
    const s=calcPortfolioSnapshot([{code:'SH600519',quantity:100,costPrice:1500}],new Map())
    expect(s.totalMarketValue).toBe(150000)
    expect(s.totalPnl).toBe(0)
    expect(s.todayPnl).toBe(0)
    expect(s.missingCount).toBe(1)
    expect(s.holdings[0].quote).toBeNull()
  })
  it('零成本、空组合没有无穷大或除零',()=>{
    const s=calcPortfolioSnapshot([{code:'SH600036',quantity:100,costPrice:0}],new Map([['SH600036',quote('SH600036',12,11)]]))
    expect(s.totalPnlPercent).toBeNull()
    expect(s.holdings[0].pnlPercent).toBeNull()
    const empty=calcPortfolioSnapshot([],new Map())
    expect(empty.totalMarketValue).toBe(0)
    expect(empty.concentration.hhi).toBe(0)
    expect(empty.concentration.effectiveN).toBe(0)
  })
  it.each([[1,'高度集中'],[.25,'集中'],[.15,'集中'],[.1,'适中'],[.05,'分散']] as const)('HHI %s 的边界等级为 %s',(hhi,level)=>{
    expect(calcConcentration([Math.sqrt(hhi)]).level).toBe(level)
  })
  it('10只等权的浮点误差不影响等级',()=>{
    const c=calcConcentration(Array(10).fill(.1))
    expect(c.hhi).toBeCloseTo(.1)
    expect(c.effectiveN).toBeCloseTo(10)
    expect(c.top3).toBeCloseTo(.3)
    expect(c.level).toBe('适中')
  })
})
describe('输入与导入',()=>{
  it.each([['600519','SH600519'],[' sz000858 ','SZ000858'],['300750','SZ300750'],['SH000858',null],['BJ830799',null],['830799',null],['600519x',null]])('规范化 %s',(raw,code)=>expect(normalizeCode(raw)).toBe(code))
  it('接受 BOM、CRLF、引号中的逗号与换行',()=>{
    const rows=parseHoldingsCsv('\uFEFF代码,名称,数量,成本价,行业,买入日期\r\n600519,"名称,测试",100,0,食品饮料,2026-11-01\r\n000858,"五粮\n液",200,90,,')
    expect(rows[0]).toMatchObject({code:'SH600519',name:'名称,测试',quantity:100,costPrice:0})
    expect(rows[1].name).toBe('五粮\n液')
  })
  it.each(['代码,名称,数量,成本价','600519,茅台,-1,100','600519,茅台,100,NaN','600519,茅台,100,100\nSH600519,茅台,200,100','600519,"未闭合,100,100'])('拒绝无效 CSV：%s',text=>expect(()=>parseHoldingsCsv(text)).toThrow())
})
