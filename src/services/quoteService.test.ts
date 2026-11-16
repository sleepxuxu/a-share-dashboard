import { describe,expect,it,vi } from 'vitest'
import { createQuoteService } from './quoteService'

const raw=(code:string,price=12)=>({code,name:code,now:price,percent:0,low:10,high:13,yesterday:10,source:'tencent'})
describe('行情缓存与容错',()=>{
  it('缓存按代码命中，新增代码不会被旧缓存遗漏',async()=>{
    let now=0
    const provider=vi.fn(async(codes:string[])=>codes.map(code=>raw(code)))
    const service=createQuoteService(provider,()=>now)
    await service.fetchQuotes(['SH600519'])
    now=1000
    const result=await service.fetchQuotes(['SH600519','SZ000858'])
    expect(result.quotes.size).toBe(2)
    expect(provider.mock.calls.map(call=>call[0])).toEqual([['SH600519'],['SZ000858']])
    expect(result.quotes.get('SZ000858')?.percent).toBe(20)
    await service.fetchQuotes(['SH600519'])
    expect(provider).toHaveBeenCalledTimes(2)
    now=30000
    await service.fetchQuotes(['SH600519'])
    expect(provider).toHaveBeenCalledTimes(3)
    await service.fetchQuotes(['SH600519'],true)
    expect(provider).toHaveBeenCalledTimes(4)
  })
  it('相交的并发请求按股票合并且返回各自需要的结果',async()=>{
    const provider=vi.fn(async(codes:string[])=>codes.map(code=>raw(code)))
    const service=createQuoteService(provider)
    const [a,b]=await Promise.all([service.fetchQuotes(['SH600519']),service.fetchQuotes(['SH600519','SZ000858'])])
    expect([...a.quotes.keys()]).toEqual(['SH600519'])
    expect(b.quotes.size).toBe(2)
    expect(provider.mock.calls.flatMap(call=>call[0]).filter(code=>code==='SH600519')).toHaveLength(1)
  })
  it('刷新失败保留旧价格和原时间戳，并标记过期',async()=>{
    let now=1
    const provider=vi.fn(async(codes:string[])=>codes.map(code=>raw(code)))
    const service=createQuoteService(provider,()=>now)
    await service.fetchQuotes(['SH600519'])
    now=31000
    provider.mockRejectedValueOnce(new Error('offline'))
    const result=await service.fetchQuotes(['SH600519'])
    expect(result.quotes.get('SH600519')?.price).toBe(12)
    expect(result.updatedAt.SH600519).toBe(1)
    expect(result.missingCodes).toEqual(['SH600519'])
  })
  it('超过50只分批请求，一批失败不会丢弃另一批结果',async()=>{
    const codes=Array.from({length:51},(_,i)=>`SH${600000+i}`)
    const provider=vi.fn(async(batch:string[])=>{if(batch.length===1)throw new Error('offline');return batch.map(code=>raw(code))})
    const result=await createQuoteService(provider).fetchQuotes(codes)
    expect(provider.mock.calls.map(call=>call[0].length)).toEqual([50,1])
    expect(result.quotes.size).toBe(50)
    expect(result.missingCodes).toEqual([codes[50]])
  })
  it('缓存未过期时强制刷新失败也标记旧行情',async()=>{
    const provider=vi.fn(async(codes:string[])=>codes.map(code=>raw(code)))
    const service=createQuoteService(provider,()=>1000)
    await service.fetchQuotes(['SH600519'])
    provider.mockRejectedValueOnce(new Error('offline'))
    const result=await service.fetchQuotes(['SH600519'],true)
    expect(result.missingCodes).toEqual(['SH600519'])
    expect(result.quotes.get('SH600519')?.price).toBe(12)
  })
  it('拒绝不合法价格与不在请求中的报价',async()=>{
    const service=createQuoteService(async()=>[raw('SH600519',NaN),raw('SZ000858'),raw('SH600036',0)])
    const result=await service.fetchQuotes(['SH600519','SH600036'])
    expect(result.quotes.size).toBe(0)
    expect(result.missingCodes).toEqual(['SH600519','SH600036'])
  })
})
