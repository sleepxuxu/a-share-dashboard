import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useHoldingStore } from '../stores/holdingStore'
import { useQuoteStore } from '../stores/quoteStore'
import { useSettingsStore } from '../stores/settingsStore'
import { fetchQuotes } from '../services/quoteService'
import { calcPortfolioSnapshot } from '../lib/portfolioCalc'
import { DEMO_HOLDINGS, DEMO_QUOTES } from '../constants/demo'
import { useRefreshInterval } from './useRefreshInterval'
export function usePortfolioQuote(){
  const saved=useHoldingStore(s=>s.holdings)
  const demo=useSettingsStore(s=>s.demo),autoRefresh=useSettingsStore(s=>s.autoRefresh)
  const state=useQuoteStore()
  const requestId=useRef(0)
  const holdings=demo?DEMO_HOLDINGS:saved
  const codesKey=holdings.map(h=>h.code).sort().join(',')
  const load=useCallback(async(force=false)=>{
    const id=++requestId.current
    if(demo||!codesKey){useQuoteStore.setState({loading:false,error:null});return}
    useQuoteStore.setState({loading:true,error:null})
    try{
      const result=await fetchQuotes(codesKey.split(','),force)
      if(id!==requestId.current)return
      if(useHoldingStore.getState().holdings.some(h=>!h.name&&result.quotes.has(h.code))){
        useHoldingStore.getState().fillNames(new Map([...result.quotes].map(([code,quote])=>[code,quote.name])))
      }
      useQuoteStore.setState(s=>({quotes:new Map([...s.quotes,...result.quotes]),updatedAt:{...s.updatedAt,...result.updatedAt},
        staleCodes:result.missingCodes,loading:false,
        error:result.missingCodes.length?`${result.missingCodes.length} 只股票未取得最新行情，已保留上次价格；无历史行情时按成本暂估。`:null,
        lastUpdated:Object.keys(result.updatedAt).length?Math.min(...Object.values(result.updatedAt)):null}))
    }catch{
      if(id===requestId.current)useQuoteStore.setState({loading:false,error:'行情连接暂不可用，已保留最近数据。',staleCodes:codesKey.split(',')})
    }
  },[codesKey,demo])
  useEffect(()=>{void load();return()=>{requestId.current++}},[load])
  useRefreshInterval(()=>{void load()},autoRefresh&&!demo&&holdings.length>0)
  const quotes=demo?DEMO_QUOTES:state.quotes
  const snapshot=useMemo(()=>calcPortfolioSnapshot(holdings,quotes),[holdings,quotes])
  return {snapshot,demo,loading:!demo&&state.loading,error:demo?null:state.error,lastUpdated:demo?null:state.lastUpdated,
    staleCodes:demo?[]:state.staleCodes,refresh:()=>load(true),autoRefresh}
}
