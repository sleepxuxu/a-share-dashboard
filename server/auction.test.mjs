import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAuctionRecord,createAuctionService,parseAuctionTicks} from './auction.mjs'
import {createFetchHandler} from './fetch-handler.mjs'

const at=Date.parse('2026-11-18T02:00:00Z')
const stock='SZ002861'
const quote={f57:'002861',f58:'瀛通通讯',f86:at/1000,f46:14.47,f51:16.46,f60:14.96}
const daily={code:'002861',klines:['2026-11-16,13.60,13.60,13.60,13.00,100000,136000000','2026-11-17,14,14.96,14.96,14,298969,400000000']}
const ticks={code:'002861',market:0,prePrice:14.96,details:['09:15:00,16.46,1000,0,4','09:24:57,14.30,8000,0,4','09:25:00,14.47,9542,30,1','09:30:00,14.5,900,2,2']}
const build=changes=>buildAuctionRecord({code:stock,name:'瀛通通讯',quote,daily,ticks,tradeDate:'2026-11-18',previousTradeDate:'2026-11-17',...changes})

test('读取精确时点、手转股，成交额由最终竞价价计算，不采用未匹配或全天量',()=>{
  const record=build()
  assert.equal(record.previousLimitUpVerified,true)
  assert.equal(record.previousLimitUpPrice,null)
  assert.equal(record.previousVolume,29896900)
  assert.equal(record.limitUpPrice,16.46)
  assert.equal(record.price091500,16.46)
  assert.equal(record.price092457,14.3)
  assert.equal(record.price092500,14.47)
  assert.equal(record.auctionVolume,954200)
  assert.equal(record.auctionAmount,13807274)
  assert.deepEqual(record.dataWarnings,[])
})

test('相邻时点不替代；同一时点冲突或错代码拒绝采用',()=>{
  const data={...ticks,details:['09:15:01,16.46,100,0,4','09:24:54,14.30,100,0,4','09:24:58,14.31,100,0,4','09:25:01,14.47,9542,0,1']}
  assert.equal(parseAuctionTicks(data,stock)['09:24:57'],null)
  assert.equal(build({ticks:data}).price091500,null)
  assert.equal(build({ticks:data}).auctionVolume,null)
  assert.equal(build({ticks:{...ticks,code:'000001'}}).price092457,null)
  const conflict={...ticks,details:[...ticks.details,'09:24:57,14.31,8000,0,4']}
  assert.equal(build({ticks:conflict}).price092457,null)
})

test('拒绝旧日期、错昨收、不匹配开盘价，零成交与缺失分开处理',()=>{
  assert.equal(build({quote:{...quote,f86:at/1000-86400}}).price091500,null)
  assert.equal(build({quote:{...quote,f60:14.95}}).price091500,null)
  assert.equal(build({ticks:{...ticks,prePrice:14.95}}).price091500,null)
  const mismatch=build({quote:{...quote,f46:14.5}})
  assert.equal(mismatch.price092500,null)
  assert.equal(mismatch.auctionAmount,null)
  const zero=build({ticks:{...ticks,details:['09:25:00,14.47,0,0,4']}})
  assert.equal(zero.auctionVolume,0)
  assert.equal(zero.auctionAmount,0)
  const missing=build({ticks:{...ticks,details:['09:25:00,14.47,-,0,4']}})
  assert.equal(missing.auctionVolume,null)
  assert.equal(missing.auctionAmount,null)
})

test('盘前、竞价中不提前使用尚未形成的最终竞价数据；缺日线不能混用',()=>{
  const record=build({quote:{...quote,f86:Date.parse('2026-11-18T01:24:00Z')/1000}})
  assert.equal(record.price091500,16.46)
  assert.equal(record.price092457,null)
  assert.equal(record.price092500,null)
  assert.match(record.dataWarnings.join('；'),/尚未形成/)
  assert.equal(build({daily:null}).previousVolume,null)
  assert.equal(build({daily:null}).price091500,null)
})

function controlledSource(){
  const calls=[];let fail=false,empty=false,wrongDate=false,partial=false
  const fetcher=async url=>{
    calls.push(url)
    if(fail)throw new Error('offline')
    const query=new URL(url).searchParams,id=query.get('secid')
    let data
    if(url.includes('getYesterdayZTPool'))data={qdate:wrongDate?20261117:20261118,tc:empty?0:1,pool:empty?[]:[{c:'002861',m:0,n:'瀛通通讯'}]}
    else if(url.includes('/kline/'))data=id==='1.000001'?{code:'000001',klines:['2026-11-13,1,1,1,1,10,10','2026-11-17,1,1,1,1,10,10','2026-11-18,1,1,1,1,10,10']}:daily
    else if(url.includes('/details/')){if(partial)throw new Error('tick source unavailable');data=ticks}
    else data=id==='1.000001'?{f57:'000001',f86:at/1000}:quote
    return Response.json({rc:0,data})
  }
  return {fetcher,calls,setFail:value=>{fail=value},setEmpty:value=>{empty=value},setWrongDate:value=>{wrongDate=value},setPartial:value=>{partial=value}}
}

test('自动扫描确认交易日，缓存60秒、合并并发、强制刷新，失败保留并标记旧快照',async()=>{
  const source=controlledSource();let clock=at
  const service=createAuctionService(source.fetcher,()=>clock)
  const [first,joined]=await Promise.all([service(),service()])
  assert.equal(first,joined)
  assert.equal(source.calls.length,6)
  assert.equal(first.tradeDate,'2026-11-18')
  assert.equal(first.previousTradeDate,'2026-11-17')
  assert.equal(first.records.length,1)
  assert.equal(first.automatic.incompleteCount,0)
  assert.equal(await service(),first)
  await service(true)
  assert.equal(source.calls.length,12)
  source.setFail(true);clock+=61000
  const stale=await service()
  assert.equal(stale.automatic.stale,true)
  assert.match(stale.automatic.warnings.at(-1),/保留上次成功快照/)
})

test('空池不是错误，池日期错位拒绝扫描；单股失败保留缺失原因',async()=>{
  const source=controlledSource()
  source.setEmpty(true)
  assert.equal((await createAuctionService(source.fetcher,()=>at)()).records.length,0)
  source.setEmpty(false);source.setWrongDate(true)
  await assert.rejects(createAuctionService(source.fetcher,()=>at)(),/日期或格式/)
  source.setWrongDate(false);source.setPartial(true)
  const result=await createAuctionService(source.fetcher,()=>at)()
  assert.equal(result.records[0].price092457,null)
  assert.equal(result.records[0].previousVolume,29896900)
  assert.match(result.records[0].dataWarnings.join('；'),/竞价分笔读取失败/)
  assert.equal(result.automatic.incompleteCount,1)
})

test('Worker Fetch 入口提供自动竞价 JSON，保留跨站校验与refresh参数',async()=>{
  let forced=false
  const handler=createFetchHandler({getAuction:async force=>{forced=force;return {tradeDate:'2026-11-18',records:[]}}})
  const env={ASSETS:{fetch:()=>new Response('assets')}}
  const response=await handler(new Request('https://gujian.test/api/auction?refresh=1'),env)
  assert.equal(response.status,200)
  assert.match(response.headers.get('content-type'),/application\/json/)
  assert.equal((await response.json()).tradeDate,'2026-11-18')
  assert.equal(forced,true)
  const denied=await handler(new Request('https://gujian.test/api/auction',{headers:{origin:'https://other.test'}}),env)
  assert.equal(denied.status,403)
})
