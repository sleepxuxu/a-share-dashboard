const STOCK_FIELDS='f2,f3,f6,f7,f8,f10,f12,f13,f14,f15,f16,f18,f62,f100,f124'
const UNIVERSE='m:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23'
const finite=value=>typeof value==='number'&&Number.isFinite(value)?value:null
const chinaDate=timestamp=>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Shanghai'}).format(new Date(timestamp))
export function normalizeMarketStock(row,sector=null){
  const code=(row.f13===1?'SH':'SZ')+row.f12
  if(!/^(SH6\d{5}|SZ[03]\d{5})$/.test(code)||typeof row.f14!=='string')return null
  return {code,name:row.f14,price:finite(row.f2),change:finite(row.f3),amount:finite(row.f6),amplitude:finite(row.f7),
    turnover:finite(row.f8),volumeRatio:finite(row.f10),high:finite(row.f15),low:finite(row.f16),yesterday:finite(row.f18),
    netFlow:finite(row.f62),industry:typeof row.f100==='string'?row.f100:'未分类',asOf:finite(row.f124)?new Date(row.f124*1000).toISOString():null,sector}
}
export function screenShortTerm(stocks,limit=5){
  const eligible=stocks.filter(s=>s&&!/ST|退/i.test(s.name)&&s.price>=2&&s.amount>=2e8&&s.change>=.5&&s.change<=7.5&&
    s.turnover>=1&&s.turnover<=18&&s.volumeRatio>=1.2&&s.asOf&&s.high>s.low&&(s.price-s.low)/(s.high-s.low)>=.45)
  const ranked=eligible.map(s=>{
    const position=(s.price-s.low)/(s.high-s.low)
    const score=Math.round(Math.min(20,Math.log10(s.amount/1e8+1)*14)+Math.min(s.volumeRatio/4,1)*25+
      Math.max(0,20-Math.abs(s.change-3.5)*5)+Math.max(0,15-Math.abs(s.turnover-6))+Math.min(10,position*10)+(s.sector?.change>0?10:0))
    const reasons=[`成交额 ${(s.amount/1e8).toFixed(2)} 亿元，流动性较活跃`,
      `量比 ${s.volumeRatio.toFixed(2)} 倍，当前成交速度高于历史同时间水平`,
      `换手 ${s.turnover.toFixed(2)}%，涨幅 ${s.change.toFixed(2)}%，未处于涨停附近`,
      ...(s.sector?[`所属热点「${s.sector.name}」上涨 ${s.sector.change.toFixed(2)}%`]:[])]
    const risks=[]
    if(s.change>=5)risks.push('当日涨幅已较大，追高可能面临回撤')
    if(s.amplitude>=8)risks.push(`日内振幅 ${s.amplitude.toFixed(2)}%，波动较大`)
    if(s.turnover>=10)risks.push('换手超过 10%，短线分歧较大')
    if(s.netFlow<0)risks.push('平台资金统计为净流出，价格与资金信号不一致')
    if(position<.75)risks.push('价格已离开日内高点，需确认承接力度')
    risks.push('仅反映当前量价快照；公告、异动与次日持续性需另行核实')
    return {...s,score,reasons,risks}
  }).sort((a,b)=>b.score-a.score||b.amount-a.amount||a.code.localeCompare(b.code))
  const groups=new Map(),result=[]
  for(const stock of ranked){
    const group=stock.sector?.name||stock.industry
    if((groups.get(group)||0)>=2)continue
    groups.set(group,(groups.get(group)||0)+1);result.push(stock)
    if(result.length>=limit)break
  }
  return result
}
async function get(url,fetcher){
  for(let attempt=0;attempt<2;attempt++){
    try{
      const response=await fetcher(url,{signal:AbortSignal.timeout(8000),headers:{Accept:'application/json','User-Agent':'Gujian/0.3'}})
      if(!response.ok)throw new Error('行情服务响应异常')
      const body=await response.json()
      if(!Array.isArray(body.data?.diff))throw new Error('行情数据格式异常')
      return body.data
    }catch(error){if(attempt===1)throw error}
  }
}
function listUrl(fs,size,fid,fields){
  return `https://push2.eastmoney.com/api/qt/clist/get?${new URLSearchParams({pn:'1',pz:String(size),po:'1',np:'1',fltt:'2',invt:'2',fid,fs,fields})}`
}
export function createMarketService(fetcher=fetch,now=Date.now){
  let cached=null,inflight=null
  return async function getMarket(force=false){
    if(!force&&cached&&now()-cached.timestamp<60000)return cached.value
    if(inflight)return inflight
    inflight=(async()=>{
      const [activeResult,sectorsResult,indexResult]=await Promise.allSettled([
        get(listUrl(UNIVERSE,100,'f6',STOCK_FIELDS),fetcher),
        get(listUrl('m:90+t:2',12,'f3','f3,f6,f12,f14,f62,f104,f105,f128,f136'),fetcher),
        get('https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001%2C0.399001%2C0.399006&fields=f2,f3,f6,f12,f14,f124&fltt=2',fetcher),
      ])
      if(activeResult.status==='rejected')throw new Error('盘面行情暂不可用，请稍后重试')
      const warnings=[]
      const rawSectors=sectorsResult.status==='fulfilled'?sectorsResult.value.diff:[]
      if(sectorsResult.status==='rejected')warnings.push('热点板块暂不可用，本次仅使用成交活跃池筛选。')
      if(indexResult.status==='rejected')warnings.push('主要指数暂不可用，无法判断整体市场强弱。')
      const usedNames=new Set()
      const sectors=rawSectors.filter(row=>typeof row.f14==='string'&&/^BK\d+$/.test(row.f12)&&finite(row.f3)!==null)
        .map(row=>({code:row.f12,name:row.f14.replace(/[ⅠⅡⅢ]+$/u,''),change:row.f3,amount:finite(row.f6),rising:finite(row.f104),falling:finite(row.f105),leader:typeof row.f128==='string'?row.f128:null}))
        .filter(sector=>{if(usedNames.has(sector.name))return false;usedNames.add(sector.name);return true}).slice(0,6)
      const all=new Map(activeResult.value.diff.map(row=>normalizeMarketStock(row)).filter(Boolean).map(stock=>[stock.code,stock]))
      const sectorResults=await Promise.allSettled(sectors.filter(s=>s.change>0).slice(0,4).map(async sector=>{
        const body=await get(listUrl(`b:${sector.code}`,30,'f6',STOCK_FIELDS),fetcher)
        return {sector,stocks:body.diff.map(row=>normalizeMarketStock(row,sector)).filter(Boolean)}
      }))
      for(const result of sectorResults){
        if(result.status==='rejected'){warnings.push('部分热点成分股读取失败，候选覆盖不完整。');continue}
        for(const stock of result.value.stocks)if(!all.get(stock.code)?.sector)all.set(stock.code,stock)
      }
      const stocks=[...all.values()]
      const timestamps=stocks.map(s=>Date.parse(s.asOf)).filter(Number.isFinite)
      if(!timestamps.length)throw new Error('行情缺少时间戳，无法生成可靠的盘面候选')
      const asOf=Math.max(...timestamps),marketDate=chinaDate(asOf)
      const isToday=marketDate===chinaDate(now()),stale=now()-asOf>5*60000||asOf-now()>60000
      const latest=stocks.filter(stock=>stock.asOf&&chinaDate(Date.parse(stock.asOf))===marketDate&&asOf-Date.parse(stock.asOf)<=5*60000)
      const candidates=screenShortTerm(latest)
      const indices=indexResult.status==='fulfilled'?indexResult.value.diff.map(row=>({name:row.f14,code:row.f12,price:finite(row.f2),change:finite(row.f3),amount:finite(row.f6),asOf:finite(row.f124)?new Date(row.f124*1000).toISOString():null})):[]
      const weak=indices.filter(index=>index.change!==null&&index.change<-1).length>=2
      if(!isToday)warnings.push('当前为上一交易日快照，等待新交易日量价确认。')
      else if(stale)warnings.push('行情超过 5 分钟未更新或时间异常，请刷新后再判断。')
      const value={asOf:new Date(asOf).toISOString(),fetchedAt:new Date(now()).toISOString(),marketDate,isToday,stale,
        universeSize:activeResult.value.total,scannedCount:latest.length,
        breadth:{rising:latest.filter(s=>s.change>0).length,falling:latest.filter(s=>s.change<0).length},
        indices,sectors,candidates,weak,
        stance:weak?'市场偏弱，优先观察承接，不追高':candidates.length?'关注放量与板块共振，等待持续性确认':'当前没有满足规则的候选，保持观察',
        warnings:[...new Set(warnings)],
        methodology:{name:'短线量价观察',description:'规则来源：项目开发者依据短线观察需求设定的启发式规则，非外部专业策略，尚未回测。数据来自东方财富公开接口。从沪深成交额前 100 及领涨前 4 板块各最多 30 只成分股筛选，排除 ST、退市标记与非沪深 A 股。不是全市场穷举。',
          filters:['股价 ≥ 2 元；成交额 ≥ 2 亿元','涨幅 0.5%–7.5%；量比 ≥ 1.2 倍','换手率 1%–18%；现价处于日内价格区间上方 45%','同一热点或行业最多 2 只；不凑满候选数量'],
          scoring:'规则匹配分按成交活跃度 20、量比 25、涨幅位置 20、换手 15、日内位置 10、正向热点 10 加权。不是预测上涨概率，未经回测验证。'},
        source:{name:'东方财富公开行情',url:'https://quote.eastmoney.com/center/gridlist.html#hs_a_board'}}
      cached={timestamp:now(),value}
      return value
    })().finally(()=>{inflight=null})
    try{return await inflight}catch(error){
      if(cached)return {...cached.value,stale:true,warnings:[...cached.value.warnings,'本次刷新失败，当前为上次成功快照。']}
      throw error
    }
  }
}
