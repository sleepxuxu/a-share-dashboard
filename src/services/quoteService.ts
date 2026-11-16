import type { Quote } from '../types/quote'
import { normalizeCode } from '../lib/normalizeCode'
interface RawQuote {code:string;name:string;now:number;percent:number;low:number;high:number;yesterday:number;source?:string}
type Provider=(codes:string[])=>Promise<RawQuote[]>
export interface QuoteResult {quotes:Map<string,Quote>;updatedAt:Record<string,number>;missingCodes:string[]}
const TTL=30_000
const deadline=<T>(promise:Promise<T>,ms:number):Promise<T>=>new Promise((resolve,reject)=>{
  const timer=setTimeout(()=>reject(new Error('行情请求超时')),ms)
  promise.then(resolve,reject).finally(()=>clearTimeout(timer))
})
export function createQuoteService(provider:Provider,now=Date.now){
  const cache=new Map<string,{quote:Quote;ts:number}>()
  const inflight=new Map<string,Promise<string[]>>()
  async function fetchQuotes(codes:string[],force=false):Promise<QuoteResult>{
    const unique=[...new Set(codes)]
    const missing=unique.filter(code=>!inflight.has(code)&&(force||!cache.has(code)||now()-cache.get(code)!.ts>=TTL))
    for(let i=0;i<missing.length;i+=50){
      const batch=missing.slice(i,i+50)
      const job=deadline(Promise.resolve().then(()=>provider(batch)),22_000).then(list=>{
        const received=new Set<string>()
        for(const s of list){
          const code=normalizeCode(s.code)
          if(!code||!batch.includes(code)||!s.name||!Number.isFinite(s.now)||s.now<=0||!Number.isFinite(s.yesterday)||s.yesterday<=0)continue
          const source=s.source==='sina'||s.source==='eastmoney'?s.source:'tencent'
          // stock-api 2.7 uses a ratio: 0.01 is 1%, unlike the percent UI field.
          cache.set(code,{quote:{code,name:s.name,price:s.now,percent:(s.now-s.yesterday)/s.yesterday*100,
            low:s.low,high:s.high,yesterday:s.yesterday,source},ts:now()})
          received.add(code)
        }
        return batch.filter(code=>!received.has(code))
      }).finally(()=>{for(const code of batch)inflight.delete(code)})
      for(const code of batch)inflight.set(code,job)
    }
    const failed=new Set<string>()
    await Promise.allSettled(unique.map(async code=>{
      const job=inflight.get(code)
      if(!job)return
      try{if((await job).includes(code))failed.add(code)}catch{failed.add(code)}
    }))
    const quotes=new Map<string,Quote>(),updatedAt:Record<string,number>={}
    for(const code of unique){const entry=cache.get(code);if(entry){quotes.set(code,entry.quote);updatedAt[code]=entry.ts}}
    return {quotes,updatedAt,missingCodes:unique.filter(code=>failed.has(code)||!cache.has(code)||now()-cache.get(code)!.ts>=TTL)}
  }
  return {fetchQuotes}
}
export const {fetchQuotes}=createQuoteService(async codes=>{
  const {stocks}=await import('stock-api')
  return stocks.auto.getStocks(codes)
})
