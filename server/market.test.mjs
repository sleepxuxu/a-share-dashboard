import { test } from 'node:test'
import assert from 'node:assert/strict'
import { normalizeMarketStock,screenShortTerm,createMarketService } from './market.mjs'

const timestamp=Date.parse('2026-11-13T06:00:00Z')
const raw=(code='002714',overrides={})=>({f12:code,f13:0,f14:'测试股票',f2:20,f3:3,f6:1500000000,f7:4,f8:5,f10:2,f15:20.1,f16:19,f18:19.42,f62:12340000,f100:'测试行业',f124:timestamp/1000,...overrides})
test('行情百分比保持原单位，缺失项保持空值',()=>{
  const stock=normalizeMarketStock(raw('002714',{f10:'-',f62:'-'}))
  assert.equal(stock.change,3);assert.equal(stock.volumeRatio,null);assert.equal(stock.netFlow,null)
  assert.equal(stock.code,'SZ002714');assert.equal(stock.asOf,'2026-11-13T06:00:00.000Z')
  assert.equal(normalizeMarketStock(raw('830799',{f13:0})),null)
})
test('排除 ST、追板、低成交、量比不足与空值，不为凑数放宽条件',()=>{
  const stocks=[raw('002714'),raw('000001',{f14:'*ST测试'}),raw('000002',{f3:9.5}),raw('000003',{f6:1e8}),raw('000004',{f10:1}),raw('000005',{f8:30}),raw('000006',{f2:19.1}),raw('000007',{f124:'-'})].map(row=>normalizeMarketStock(row))
  const result=screenShortTerm(stocks)
  assert.deepEqual(result.map(stock=>stock.code),['SZ002714'])
  assert.ok(result[0].reasons.length>=3);assert.ok(result[0].risks.length>=1)
})
test('同一行业最多两只，风险内容明确说明资金背离和追高',()=>{
  const stocks=['000001','000002','000003','000004'].map(code=>normalizeMarketStock(raw(code,{f3:6,f62:-1,f7:10})))
  const result=screenShortTerm(stocks)
  assert.equal(result.length,2)
  assert.ok(result[0].risks.some(risk=>risk.includes('追高')))
  assert.ok(result[0].risks.some(risk=>risk.includes('净流出')))
})
test('盘面服务合并与缓存，失败后返回带过期标记的旧快照',async()=>{
  let calls=0,fail=false
  const fetcher=async url=>{
    calls++;if(fail)throw new Error('offline')
    const parsed=new URL(url)
    const diff=parsed.pathname.includes('ulist')?[{f12:'000001',f14:'上证指数',f2:3600,f3:-2,f124:timestamp/1000}]:parsed.searchParams.get('fs')==='m:90+t:2'?[]:[raw('002714'),raw('000651',{f100:'家用电器'})]
    return new Response(JSON.stringify({data:{total:5000,diff}}))
  }
  const getMarket=createMarketService(fetcher,()=>timestamp+1000)
  const [a,b]=await Promise.all([getMarket(),getMarket()])
  assert.deepEqual(a,b);assert.equal(calls,3);assert.equal(a.isToday,true);assert.equal(a.stale,false);assert.equal(a.candidates.length,2)
  await getMarket();assert.equal(calls,3)
  fail=true
  const old=await getMarket(true);assert.equal(old.stale,true);assert.equal(old.asOf,a.asOf)
  assert.ok(old.warnings.some(warning=>warning.includes('刷新失败')))
})
test('旧交易日数据明确标记，未带时间的记录不进入候选',async()=>{
  const fetcher=async url=>{
    const parsed=new URL(url),isSector=parsed.searchParams.get('fs')==='m:90+t:2'
    return new Response(JSON.stringify({data:{total:10,diff:isSector?[]:[raw('002714'),raw('000651',{f124:'-'})]}}))
  }
  const result=await createMarketService(fetcher,()=>timestamp+86400000)()
  assert.equal(result.isToday,false);assert.equal(result.stale,true);assert.equal(result.scannedCount,1)
  assert.ok(result.warnings.some(warning=>warning.includes('上一交易日')))
})
