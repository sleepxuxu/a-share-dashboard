const UT='7eea3edcaed734bea9cbfc24409ed989'
const validCode=code=>/^(SH6\d{5}|SZ[03]\d{5})$/.test(code)
const numeric=value=>value!==''&&value!==null&&value!==undefined&&value!=='-'&&Number.isFinite(Number(value))?Number(value):null
const positive=value=>numeric(value)>0?Number(value):null
const samePrice=(a,b)=>a!==null&&b!==null&&Math.round(a*100)===Math.round(b*100)
const chinaDate=timestamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(timestamp))
const chinaTime=timestamp=>new Intl.DateTimeFormat('en-GB',{timeZone:'Asia/Shanghai',hour:'2-digit',minute:'2-digit',second:'2-digit',hour12:false}).format(new Date(timestamp))
const secid=code=>`${code.startsWith('SH')?'1':'0'}.${code.slice(2)}`
const dateNumber=value=>Number(value.replaceAll('-',''))

export function auctionUrls(code){
  const id=secid(code)
  return {
    quote:`https://push2.eastmoney.com/api/qt/stock/get?secid=${id}&fields=f46,f51,f57,f58,f60,f86&fltt=2`,
    // pos=0 requests the beginning of the session; iscca=1 includes indicative auction ticks.
    ticks:`https://push2.eastmoney.com/api/qt/stock/details/get?secid=${id}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55&pos=0&iscca=1&fltt=2`,
    daily:`https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&lmt=15&end=20500101`,
  }
}

export function parseAuctionTicks(data,expectedCode){
  if(!data||data.code!==expectedCode.slice(2)||Number(data.market)!==(expectedCode.startsWith('SH')?1:0)||!Array.isArray(data.details))throw new Error('竞价分笔代码或格式不匹配')
  const grouped=new Map()
  for(const raw of data.details){
    if(typeof raw!=='string')continue
    const parts=raw.split(','),time=parts[0]
    if(!['09:15:00','09:24:57','09:25:00'].includes(time))continue
    const price=positive(parts[1]),hands=numeric(parts[2])
    const volume=hands!==null&&hands>=0&&Number.isSafeInteger(hands*100)?hands*100:null
    const tick={time,price,volume}
    if(!grouped.has(time))grouped.set(time,[])
    grouped.get(time).push(tick)
  }
  const result={}
  for(const time of ['09:15:00','09:24:57','09:25:00']){
    const rows=grouped.get(time)||[]
    // Never silently select one of conflicting snapshots at an identical timestamp.
    result[time]=rows.length&&rows.every(row=>row.price===rows[0].price&&row.volume===rows[0].volume)?rows[0]:null
  }
  return result
}

export function buildAuctionRecord({code,name,quote,daily,ticks,tradeDate,previousTradeDate,sourceFailures=[]}){
  const warnings=[...sourceFailures]
  const record={code,name,previousClose:null,previousLimitUpPrice:null,previousLimitUpVerified:true,previousVolume:null,
    limitUpPrice:null,price091500:null,price092457:null,price092500:null,auctionVolume:null,auctionAmount:null,dataWarnings:warnings}
  if(daily?.code===code.slice(2)&&Array.isArray(daily.klines)){
    const previous=daily.klines.find(line=>typeof line==='string'&&line.startsWith(previousTradeDate+','))?.split(',')
    if(previous){
      record.previousClose=positive(previous[2])
      const hands=numeric(previous[5])
      record.previousVolume=hands!==null&&hands>0&&Number.isSafeInteger(hands*100)?hands*100:null
    }
  }
  if(record.previousVolume===null)warnings.push('缺少前一交易日未复权日线成交量')
  const timestamp=positive(quote?.f86),quoteDate=timestamp?chinaDate(timestamp*1000):null
  if(!quote||quote.f57!==code.slice(2)||quoteDate!==tradeDate){warnings.push('个股行情日期与本轮交易日不一致，未采用竞价数据');return record}
  record.quoteAsOf=new Date(timestamp*1000).toISOString()
  record.limitUpPrice=positive(quote.f51)
  if(!samePrice(record.previousClose,positive(quote.f60))){warnings.push('昨收与未复权日线不一致，未采用竞价数据');return record}
  if(!ticks||!samePrice(positive(ticks.prePrice),record.previousClose)){warnings.push('竞价分笔昨收缺失或与本轮行情不一致');return record}
  let points
  try{points=parseAuctionTicks(ticks,code)}catch{warnings.push('竞价分笔格式不匹配');return record}
  const elapsed=chinaTime(timestamp*1000)
  for(const [time,field] of [['09:15:00','price091500'],['09:24:57','price092457'],['09:25:00','price092500']]){
    if(elapsed<time){warnings.push(`${time} 尚未形成`);continue}
    const point=points[time]
    if(!point||point.price===null){warnings.push(`缺少精确 ${time} 快照，未用邻近时点替代`);continue}
    if(record.limitUpPrice!==null&&point.price>record.limitUpPrice){warnings.push(`${time} 价格高于今日涨停价，未采用`);continue}
    record[field]=point.price
  }
  const final=points['09:25:00']
  if(record.price092500!==null){
    if(!samePrice(record.price092500,positive(quote.f46))){
      record.price092500=null;warnings.push('09:25 分笔与当日开盘价不一致，最终竞价数据待核验')
    }else if(final?.volume!==null&&final?.volume!==undefined){
      record.auctionVolume=final.volume
      // The opening call auction clears at a single price. Volume is converted from lots to shares.
      record.auctionAmount=Math.round(record.price092500*100)*final.volume/100
    }else warnings.push('09:25 竞价成交量缺失，无法计算竞价成交额')
  }
  return record
}

async function getJson(url,fetcher){
  let lastError
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetcher(url,{signal:AbortSignal.timeout(10000),headers:{Accept:'application/json','User-Agent':'Gujian/0.4'}})
      if(!response.ok)throw new Error('竞价数据源响应异常')
      const body=await response.json()
      if(body.rc!==0||!body.data)throw new Error('竞价数据源暂无数据')
      return body.data
    }catch(error){lastError=error}
  }
  throw lastError
}

async function mapLimit(items,limit,fn){
  const output=new Array(items.length);let next=0
  await Promise.all(Array.from({length:Math.min(items.length,limit)},async()=>{
    while(next<items.length){const index=next++;output[index]=await fn(items[index])}
  }))
  return output
}

export function createAuctionService(fetcher=fetch,now=Date.now){
  let cache=null,inflight=null
  return async function getAuction(force=false){
    if(!force&&cache&&now()-cache.at<60000)return cache.value
    if(inflight)return inflight
    inflight=(async()=>{
      const benchmark=auctionUrls('SH000001')
      const [reference,calendar]=await Promise.all([getJson(benchmark.quote,fetcher),getJson(benchmark.daily,fetcher)])
      const timestamp=positive(reference.f86)
      if(!timestamp||reference.f57!=='000001'||calendar.code!=='000001')throw new Error('无法确认竞价交易日期')
      const tradeDate=chinaDate(timestamp*1000)
      const dates=(calendar.klines||[]).filter(line=>typeof line==='string').map(line=>line.split(',')[0]).filter(value=>/^\d{4}-\d{2}-\d{2}$/.test(value)&&value<tradeDate).sort()
      const previousTradeDate=dates.at(-1)
      if(!previousTradeDate)throw new Error('无法确认前一交易日')
      const pool=await getJson(`https://push2ex.eastmoney.com/getYesterdayZTPool?${new URLSearchParams({ut:UT,dpt:'wz.ztzt',Pageindex:'0',pagesize:'5000',sort:'zs:desc',date:String(dateNumber(tradeDate))})}`,fetcher)
      if(Number(pool.qdate)!==dateNumber(tradeDate)||!Array.isArray(pool.pool))throw new Error('昨日涨停池日期或格式不匹配')
      if(Number(pool.tc)!==pool.pool.length)throw new Error('昨日涨停池返回不完整，请稍后刷新')
      const seen=new Set()
      const stocks=pool.pool.map(row=>({code:(row.m===1?'SH':'SZ')+row.c,name:row.n})).filter(stock=>{
        if(!validCode(stock.code)||typeof stock.name!=='string'||seen.has(stock.code))return false
        seen.add(stock.code);return true
      })
      if(stocks.length>500)throw new Error('昨日涨停池超出单次扫描上限（500 只）')
      const records=await mapLimit(stocks,5,async stock=>{
        const urls=auctionUrls(stock.code)
        const results=await Promise.allSettled([getJson(urls.quote,fetcher),getJson(urls.daily,fetcher),getJson(urls.ticks,fetcher)])
        const [quote,daily,ticks]=results.map(result=>result.status==='fulfilled'?result.value:null)
        const sourceFailures=results.flatMap((result,index)=>result.status==='rejected'?[['实时行情读取失败','未复权日线读取失败','竞价分笔读取失败'][index]]:[])
        return buildAuctionRecord({...stock,quote,daily,ticks,tradeDate,previousTradeDate,sourceFailures})
      })
      const fetchedAt=new Date(now()).toISOString(),isToday=tradeDate===chinaDate(now()),elapsed=chinaTime(timestamp*1000)
      const warnings=['扫描范围为东方财富昨日涨停池中的沪深 A 股；不含该池未覆盖的 ST、科创板及未开板新股，非全市场穷举。',
        '分笔不单独携带交易日期；按同期实时行情日期、分笔昨收与未复权日线交叉核验。',
        '竞价成交额按 09:25 最终价格 × 成交股数计算，未使用全天成交额。']
      if(!isToday)warnings.push('当前为最近交易日的历史快照，不代表今日竞价。')
      if(elapsed<'09:25:00')warnings.push('09:25 最终竞价尚未形成；缺失时点暂标记待核验。')
      const incomplete=records.filter(row=>['price091500','price092457','price092500','auctionVolume','previousVolume','limitUpPrice'].some(field=>row[field]===null)).length
      if(incomplete)warnings.push(`${incomplete} 只股票存在缺失或未通过数据核验的字段，请查看逐股说明。`)
      const value={schemaVersion:1,tradeDate,previousTradeDate,source:'东方财富 · 昨日涨停池 / 含竞价分笔 / 实时行情 / 未复权日线',records,
        automatic:{fetchedAt,asOf:new Date(timestamp*1000).toISOString(),isToday,stale:!isToday||now()-timestamp*1000>5*60000||timestamp*1000-now()>60000,
          poolCount:pool.pool.length,scannedCount:records.length,incompleteCount:incomplete,warnings}}
      cache={at:now(),value}
      return value
    })().finally(()=>{inflight=null})
    try{return await inflight}catch(error){
      if(cache)return {...cache.value,automatic:{...cache.value.automatic,stale:true,warnings:[...cache.value.automatic.warnings,'本次自动取数失败，保留上次成功快照，请留意交易日期。']}}
      throw error
    }
  }
}
