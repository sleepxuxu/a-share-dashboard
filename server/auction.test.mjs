import test from 'node:test'
import assert from 'node:assert/strict'
import {buildAuctionRecord,createAuctionService,createAuctionPreparation,parseAuctionTicks} from './auction.mjs'
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

test('固定时点及最终窗口外不替代；同一时点冲突或错代码拒绝采用',()=>{
  const data={...ticks,details:['09:15:03,16.46,100,0,4','09:24:54,14.30,100,0,4','09:24:58,14.31,100,0,4','09:25:06,14.47,9542,0,1']}
  assert.equal(parseAuctionTicks(data,stock)['09:24:57'],null)
  assert.equal(build({ticks:data}).price091500,null)
  assert.equal(build({ticks:data}).auctionVolume,null)
  assert.equal(build({ticks:{...ticks,code:'000001'}}).price092457,null)
  const conflict={...ticks,details:[...ticks.details,'09:24:57,14.31,8000,0,4']}
  assert.equal(build({ticks:conflict}).price092457,null)
})

test('开竞价允许00、01、02秒精确报价，冲突及未来报价不采用，03秒不补齐',()=>{
  for(const second of ['00','01','02']){
    const details=ticks.details.map(line=>line.replace('09:15:00',`09:15:${second}`))
    const record=build({ticks:{...ticks,details}})
    assert.equal(record[`price0915${second}`],16.46)
    if(second!=='00')assert.equal(record.price091500,null)
    assert.deepEqual(record.dataWarnings,[])
  }
  const details=['09:15:02,16.46,100,0,4','09:15:01,16.45,100,0,4','09:15:02,16.45,100,0,4']
  assert.equal(build({ticks:{...ticks,details}}).price091502,null)
  assert.equal(build({ticks:{...ticks,details}}).price091501,16.45)
  const points=parseAuctionTicks({...ticks,details},stock,'09:15:00')
  assert.equal(points['09:15:01'],null)
  assert.equal(points['09:15:02'],null)
  const missing=build({ticks:{...ticks,details:['09:15:03,16.46,100,0,4']}})
  assert.equal(missing.price091501,null)
  assert.equal(missing.price091502,null)
  assert.ok(missing.dataWarnings.some(message=>message.includes('开竞价条件待核验')))
})

test('独立读取57、58、59秒，缺失57时保留58或59；冲突与未来时点不补齐',()=>{
  for(const second of ['57','58','59']){
    const record=build({ticks:{...ticks,details:[`09:24:${second},14.30,8000,0,4`,'09:25:02,14.47,9542,0,1']}})
    assert.equal(record[`price0924${second}`],14.3)
    assert.equal(record.auctionTime,'09:25:02')
    assert.equal(record.auctionVolume,954200)
  }
  const details=['09:24:59,14.31,8000,0,4','09:24:58,14.30,8000,0,4','09:24:59,14.32,8000,0,4']
  const record=build({ticks:{...ticks,details}})
  assert.equal(record.price092457,null)
  assert.equal(record.price092458,14.3)
  assert.equal(record.price092459,null)
  const points=parseAuctionTicks({...ticks,details},stock,'09:24:57')
  assert.equal(points['09:24:58'],null)
  assert.equal(points['09:24:59'],null)
})

test('最终竞价窗口包含 00 至 05 秒，乱序取最新一笔且价量同源，06 秒排除',()=>{
  for(let second=0;second<=5;second++){
    const time=`09:25:0${second}`
    const record=build({ticks:{...ticks,details:[`${time},14.47,9542,0,1`]}})
    assert.equal(record.auctionTime,time)
    assert.equal(record.price092500,14.47)
    assert.equal(record.auctionVolume,954200)
  }
  const details=['09:25:05,14.47,10000,0,1','09:25:00,14.40,9000,0,1','09:25:06,14.48,11000,0,1']
  const record=build({ticks:{...ticks,details}})
  assert.equal(record.auctionTime,'09:25:05')
  assert.equal(record.auctionVolume,1000000)
  assert.equal(record.auctionAmount,14470000)
  const early=build({quote:{...quote,f46:14.4,f86:Date.parse('2026-11-18T09:25:04+08:00')/1000},ticks:{...ticks,details}})
  assert.equal(early.price092500,14.4)
  assert.equal(early.auctionTime,'09:25:00')
  assert.equal(early.auctionVolume,900000)
  const conflict=build({ticks:{...ticks,details:[...details,'09:25:05,14.47,10001,0,1']}})
  assert.equal(conflict.price092500,null)
  assert.equal(conflict.auctionVolume,null)
  const missing=build({ticks:{...ticks,details:['09:25:00,14.47,9542,0,1','09:25:05,14.47,-,0,1']}})
  assert.equal(missing.auctionTime,'09:25:05')
  assert.equal(missing.auctionVolume,null)
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

test('自动扫描确认交易日，缓存30秒、合并并发、强制刷新，失败保留并标记旧快照',async()=>{
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
  assert.equal(source.calls.length,9)
  assert.equal(first.automatic.diagnostics.requestCount,6)
  assert.equal(first.automatic.diagnostics.cacheHitCount,0)
  source.setFail(true);clock+=61000
  const stale=await service()
  assert.equal(stale.automatic.stale,true)
  assert.match(stale.automatic.warnings.at(-1),/保留上次成功快照/)
})

test('缓存满30秒重新取数，30秒之前复用结果',async()=>{
  const source=controlledSource();let clock=at
  const service=createAuctionService(source.fetcher,()=>clock)
  const first=await service()
  clock+=29999
  assert.equal(await service(),first)
  assert.equal(source.calls.length,6)
  clock+=1
  assert.notEqual(await service(),first)
  assert.equal(source.calls.length,9)
})

test('09:25:05 到点后失效窗口结束前的缓存，不等待 60 秒',async()=>{
  const source=controlledSource();let clock=Date.parse('2026-11-18T09:25:04+08:00')
  const fetcher=async url=>{
    const response=await source.fetcher(url)
    const body=await response.json()
    if(body.data.f86)body.data.f86=clock/1000
    return Response.json(body)
  }
  const service=createAuctionService(fetcher,()=>clock)
  const preview=await service()
  assert.match(preview.automatic.warnings.join('；'),/取数窗口尚未结束/)
  assert.equal(await service(),preview)
  clock+=1000
  const final=await service()
  assert.equal(source.calls.length,9)
  assert.notEqual(final,preview)
  assert.equal(final.automatic.warnings.some(message=>message.includes('取数窗口尚未结束')),false)
  assert.equal(await service(),final)
})

test('09:25:05 取消尚未完成的预览扫描，强刷及旧调用都取得新一轮结果',async()=>{
  const source=controlledSource();let clock=Date.parse('2026-11-18T09:24:59+08:00')
  let release,ready,oldSignal,firstTick=true
  const gate=new Promise(resolve=>{release=resolve})
  const started=new Promise(resolve=>{ready=resolve})
  const fetcher=async(url,options)=>{
    const body=await (await source.fetcher(url)).json()
    if(body.data.f86)body.data.f86=clock/1000
    if(url.includes('/details/')&&firstTick){
      firstTick=false;oldSignal=options.signal;ready();await gate
    }
    return Response.json(body)
  }
  const service=createAuctionService(fetcher,()=>clock)
  const preview=service()
  await started
  clock=Date.parse('2026-11-18T09:25:05+08:00')
  const forced=service(true),joined=service(true)
  assert.equal(oldSignal.aborted,true)
  const final=await forced
  assert.equal(final.records[0].price092500,14.47)
  assert.equal(final.automatic.asOf,new Date(clock).toISOString())
  assert.equal(await joined,final)
  // Even a provider that finishes late after cancellation must not overwrite
  // the final cache or return a stale preview to its original caller.
  release()
  assert.equal(await preview,final)
  assert.equal(await service(),final)
  assert.equal(source.calls.filter(url=>url.includes('/details/')).length,2)
  assert.equal(source.calls.filter(url=>url.includes('/stock/get')&&url.includes('1.000001')).length,2)
})

test('窗口前启动、窗口后完成的快照仍失效，不按缓存写入时间误判',async()=>{
  const source=controlledSource();let clock=Date.parse('2026-11-18T09:24:59+08:00'),cross=true
  const fetcher=async url=>{
    const body=await (await source.fetcher(url)).json()
    if(body.data.f86)body.data.f86=clock/1000
    if(url.includes('/details/')&&cross){cross=false;clock+=6000}
    return Response.json(body)
  }
  const service=createAuctionService(fetcher,()=>clock)
  const preview=await service()
  assert.equal(preview.records[0].price092500,null)
  const final=await service()
  assert.equal(final.records[0].price092500,14.47)
  assert.notEqual(final,preview)
})

test('缓存昨日资料但实时价量每轮重取，缓存按交易日失效',async()=>{
  const source=controlledSource();let clock=at,volume=9542
  const fetcher=async url=>{
    const body=await (await source.fetcher(url)).json()
    if(body.data.f86)body.data.f86=clock/1000
    if(url.includes('/details/'))body.data.details=ticks.details.map(line=>line.replace('9542',String(volume)))
    if(clock>=at+86400000){
      if(url.includes('getYesterdayZTPool'))body.data.qdate=20261119
      if(url.includes('/kline/')&&body.data.code==='002861')body.data.klines=[...daily.klines,'2026-11-18,14,14.96,15,14,100000,150000000']
    }
    return Response.json(body)
  }
  const service=createAuctionService(fetcher,()=>clock)
  await service()
  volume=10000
  const refreshed=await service(true)
  assert.equal(refreshed.records[0].auctionVolume,1000000)
  assert.equal(refreshed.automatic.diagnostics.requestCount,3)
  assert.equal(refreshed.automatic.diagnostics.cacheHitCount,3)
  assert.equal(source.calls.filter(url=>url.includes('/kline/')).length,2)
  assert.equal(source.calls.filter(url=>url.includes('getYesterdayZTPool')).length,1)
  clock+=60000
  await service(true)
  assert.equal(source.calls.filter(url=>url.includes('getYesterdayZTPool')).length,2)
  clock=at+86400000
  const nextDay=await service(true)
  assert.equal(nextDay.tradeDate,'2026-11-19')
  assert.equal(nextDay.previousTradeDate,'2026-11-18')
  assert.equal(nextDay.records[0].previousVolume,10000000)
  assert.equal(nextDay.automatic.diagnostics.cacheHitCount,0)
  assert.equal(nextDay.automatic.diagnostics.requestCount,6)
})

test('缺失的昨日成交量和空候选池不缓存，下轮可补取',async()=>{
  const source=controlledSource();let missing=true
  const fetcher=async url=>{
    const body=await (await source.fetcher(url)).json()
    if(url.includes('/kline/')&&body.data.code==='002861'&&missing)body.data.klines=[]
    return Response.json(body)
  }
  const service=createAuctionService(fetcher,()=>at)
  assert.equal((await service()).records[0].previousVolume,null)
  missing=false
  assert.equal((await service(true)).records[0].previousVolume,29896900)
  assert.equal(source.calls.filter(url=>url.includes('/kline/')&&url.includes('0.002861')).length,2)
  const emptySource=controlledSource(),emptyService=createAuctionService(emptySource.fetcher,()=>at)
  emptySource.setEmpty(true)
  assert.equal((await emptyService()).records.length,0)
  emptySource.setEmpty(false)
  assert.equal((await emptyService(true)).records.length,1)
})

test('个股接口失败不在同轮重复等待，保留缺失并在下一轮恢复',async()=>{
  const source=controlledSource(),service=createAuctionService(source.fetcher,()=>at)
  source.setPartial(true)
  const partial=await service()
  assert.equal(partial.records[0].price092500,null)
  assert.equal(source.calls.filter(url=>url.includes('/details/')).length,1)
  assert.match(partial.records[0].dataWarnings.join('；'),/竞价分笔读取失败/)
  source.setPartial(false)
  assert.equal((await service(true)).records[0].price092500,14.47)
  let failDaily=true
  const dailySource=controlledSource()
  const dailyService=createAuctionService(async url=>{
    if(url.includes('/kline/')&&url.includes('0.002861')&&failDaily){
      dailySource.calls.push(url)
      throw new Error('daily unavailable')
    }
    return dailySource.fetcher(url)
  },()=>at)
  assert.equal((await dailyService()).records[0].previousVolume,null)
  assert.equal(dailySource.calls.filter(url=>url.includes('/kline/')&&url.includes('0.002861')).length,1)
  failDaily=false
  assert.equal((await dailyService(true)).records[0].previousVolume,29896900)
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

test('仅缺00秒但01或02有效时，不把开竞价条件计为缺失',async()=>{
  for(const second of ['01','02']){
    const source=controlledSource()
    const fetcher=async url=>{
      if(url.includes('/details/'))return Response.json({rc:0,data:{...ticks,details:ticks.details.map(line=>line.replace('09:15:00',`09:15:${second}`))}})
      return source.fetcher(url)
    }
    const result=await createAuctionService(fetcher,()=>at)()
    assert.equal(result.records[0].price091500,null)
    assert.equal(result.records[0][`price0915${second}`],16.46)
    assert.equal(result.automatic.incompleteCount,0)
  }
})

test('仅缺57秒但58或59有效时，不把比较条件计为缺失',async()=>{
  for(const second of ['58','59']){
    const source=controlledSource()
    const fetcher=async url=>{
      if(url.includes('/details/'))return Response.json({rc:0,data:{...ticks,details:ticks.details.map(line=>line.replace('09:24:57',`09:24:${second}`))}})
      return source.fetcher(url)
    }
    const result=await createAuctionService(fetcher,()=>at)()
    assert.equal(result.records[0].price092457,null)
    assert.equal(result.records[0][`price0924${second}`],14.3)
    assert.equal(result.automatic.incompleteCount,0)
  }
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

test('昨日候选池及成交量跨服务实例保存复用，个股行情与竞价仍实时获取',async()=>{
  let saved=null
  const store={load:async date=>saved?.sourceDate===date?structuredClone(saved):null,save:async value=>{saved=structuredClone(value)}}
  const firstSource=controlledSource()
  const first=await createAuctionService(firstSource.fetcher,()=>at,store)()
  assert.equal(first.automatic.candidatePool.persisted,true)
  assert.equal(saved.sourceDate,'2026-11-17')
  assert.equal(saved.stocks[0].daily.klines.length,1)
  const source=controlledSource()
  const restarted=await createAuctionService(source.fetcher,()=>at,store)()
  assert.equal(restarted.automatic.candidatePool.reused,true)
  assert.equal(restarted.automatic.diagnostics.persistedDailyCount,1)
  assert.equal(source.calls.length,4)
  assert.ok(!source.calls.some(url=>url.includes('getYesterdayZTPool')))
  assert.ok(!source.calls.some(url=>url.includes('/kline/')&&url.includes('0.002861')))
  assert.equal(restarted.records[0].auctionVolume,first.records[0].auctionVolume)
})

test('错日或未来候选池不复用，存储失败回退公开源并提示',async()=>{
  for(const bad of [
    {sourceDate:'2026-11-16',savedAt:'2026-11-18T02:00:00Z'},
    {sourceDate:'2026-11-17',savedAt:'2026-11-19T02:00:00Z'},
  ]){
    const source=controlledSource()
    const value={schemaVersion:1,origin:'previous',...bad,stocks:[{code:stock,name:'存储测试',daily}]}
    const result=await createAuctionService(source.fetcher,()=>at,{load:async()=>value,save:async()=>{}})()
    assert.equal(result.automatic.candidatePool.reused,false)
    assert.ok(source.calls.some(url=>url.includes('getYesterdayZTPool')))
  }
  const source=controlledSource()
  const result=await createAuctionService(source.fetcher,()=>at,{load:async()=>{throw new Error('disk failure')},save:async()=>{throw new Error('disk failure')}})()
  assert.equal(result.records[0].price092500,14.47)
  assert.equal(result.automatic.candidatePool.persisted,false)
  assert.match(result.automatic.warnings.join('；'),/读取失败/)
  assert.match(result.automatic.warnings.join('；'),/未能持久保存/)
})

test('准备周五收盘涨停池，周一按前一交易日复用且实时名称更新ST过滤依据',async()=>{
  let clock=Date.parse('2026-11-27T15:10:00+08:00'),saved=null
  const calls=[]
  const store={load:async date=>saved?.sourceDate===date?saved:null,save:async value=>{saved=structuredClone(value)}}
  const fetcher=async url=>{
    calls.push(url)
    const id=new URL(url).searchParams.get('secid')
    let data
    if(url.includes('getTopicZTPool')) data={qdate:20261127,tc:1,pool:[{m:0,c:'002861',n:'周五股票'}]}
    else if(url.includes('getYesterdayZTPool'))throw new Error('must use prepared pool')
    else if(url.includes('/kline/'))data=id==='1.000001'?{code:'000001',klines:['2026-11-26,1,1,1,1,100,100','2026-11-27,1,1,1,1,100,100']}:{code:'002861',klines:['2026-11-27,14,14.96,14.96,14,298969,400000000']}
    else if(url.includes('/details/'))data=ticks
    else data=id==='1.000001'?{f57:'000001',f86:clock/1000}:{...quote,f58:'ST测试',f86:clock/1000}
    return Response.json({rc:0,data})
  }
  const prepared=await createAuctionPreparation(fetcher,()=>clock,store)()
  assert.equal(prepared.sourceDate,'2026-11-27')
  assert.equal(prepared.dailyCount,1)
  assert.match(prepared.message,/下一个交易日/)
  calls.length=0
  clock=Date.parse('2026-11-30T09:25:05+08:00')
  const snapshot=await createAuctionService(fetcher,()=>clock,store)()
  assert.equal(snapshot.previousTradeDate,'2026-11-27')
  assert.equal(snapshot.automatic.candidatePool.reused,true)
  assert.equal(snapshot.records[0].name,'ST测试')
  assert.equal(calls.length,4)
})

test('收盘准备拒绝盘中、非今日收盘行情及不完整源池，不覆盖原文件',async()=>{
  let clock=Date.parse('2026-11-27T14:59:59+08:00'),writes=0,calls=0,mode='old'
  const store={load:async()=>null,save:async()=>{writes++}}
  const fetcher=async url=>{
    calls++
    return Response.json({rc:0,data:url.includes('getTopicZTPool')?{qdate:20261127,tc:2,pool:[]}:{f57:'000001',f86:mode==='old'?at/1000:clock/1000}})
  }
  const prepare=createAuctionPreparation(fetcher,()=>clock,store)
  await assert.rejects(prepare(),/15:05/)
  assert.equal(calls,0)
  clock=Date.parse('2026-11-27T15:10:00+08:00')
  await assert.rejects(prepare(),/收盘行情/)
  mode='partial'
  await assert.rejects(prepare(),/不完整/)
  assert.equal(writes,0)
})

test('准备候选池 API 使用服务端数据并沿用跨站限制',async()=>{
  let calls=0
  const handler=createFetchHandler({prepareAuction:async()=>{calls++;return {sourceDate:'2026-11-27',stockCount:1,message:'已保存'}}})
  const env={ASSETS:{fetch:()=>new Response('assets')}}
  const ok=await handler(new Request('https://gujian.test/api/auction/prepare',{method:'POST'}),env)
  assert.equal(ok.status,200)
  assert.equal((await ok.json()).stockCount,1)
  const denied=await handler(new Request('https://gujian.test/api/auction/prepare',{method:'POST',headers:{origin:'https://other.test'}}),env)
  assert.equal(denied.status,403)
  assert.equal(calls,1)
})
