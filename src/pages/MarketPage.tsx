import { useCallback,useEffect,useRef,useState } from 'react'
import { ArrowUpRight,RefreshCw,Flame,Star,Check,Info,Clock3,ChevronDown,ScanLine,Activity,ExternalLink,X } from 'lucide-react'
import type { MarketCandidate,MarketSnapshot } from '../types/market'
import { useWatchlistStore } from '../stores/watchlistStore'
import { useRefreshInterval } from '../hooks/useRefreshInterval'
import { signedPercent,number,tone } from '../lib/formatters'
import { Modal } from '../components/layout/Modal'
import { FundamentalsPanel } from '../components/research/FundamentalsPanel'
import { SkillResearchPanel } from '../components/research/SkillResearchPanel'
import { normalizeCode } from '../lib/normalizeCode'
const money=(amount:number)=>`${number(amount/1e8)} 亿`
const dateTime=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})

export function MarketPage(){
  const [data,setData]=useState<MarketSnapshot|null>(null),[loading,setLoading]=useState(true),[error,setError]=useState('')
  const [sector,setSector]=useState('all'),[onlyWatched,setOnlyWatched]=useState(false),[auto,setAuto]=useState(false)
  const [research,setResearch]=useState<Pick<MarketCandidate,'code'|'name'>|null>(null),[notice,setNotice]=useState('')
  const [researchCode,setResearchCode]=useState(''),[codeError,setCodeError]=useState('')
  const request=useRef<AbortController|null>(null),noticeTimer=useRef<number|undefined>(undefined)
  const watched=useWatchlistStore(s=>s.stocks),toggle=useWatchlistStore(s=>s.toggle)
  const load=useCallback(async(force=false)=>{
    request.current?.abort();const controller=new AbortController();request.current=controller
    setLoading(true);setError('')
    try{
      const response=await fetch(`/api/market${force?'?refresh=1':''}`,{signal:controller.signal})
      if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('盘面服务未启动，请使用 npm run dev 或 npm start。')
      const result=await response.json();if(!response.ok)throw new Error(result.error||'暂时无法取得盘面')
      if(!controller.signal.aborted)setData(result)
    }catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'盘面读取失败，请重试。')}
    finally{if(!controller.signal.aborted)setLoading(false)}
  },[])
  useEffect(()=>{void load();return()=>{request.current?.abort();window.clearTimeout(noticeTimer.current)}},[load])
  useRefreshInterval(()=>void load(),auto,60000)
  function observe(stock:MarketCandidate){
    const exists=watched.some(s=>s.code===stock.code);toggle(stock)
    setNotice(exists?`已移出观察：${stock.name}`:`已加入观察：${stock.name}`)
    window.clearTimeout(noticeTimer.current);noticeTimer.current=window.setTimeout(()=>setNotice(''),2600)
  }
  const availableSectors=[...new Set(data?.candidates.map(stock=>stock.sector?.name||stock.industry)||[])]
  const rows=data?.candidates.filter(stock=>(sector==='all'||(stock.sector?.name||stock.industry)===sector)&&(!onlyWatched||watched.some(s=>s.code===stock.code)))||[]
  return <main className="page market-page">
    <div className="page-heading"><div><div className="eyebrow"><span/>MARKET RADAR</div><h1>先看盘面，再找机会<span className="heading-dot">.</span></h1><p>聚焦当日热点与量价，筛出值得继续研究的短线候选。</p></div><div className="market-heading-actions"><span className="strategy-label"><ScanLine size={16}/>短线量价观察</span><button className="button primary" disabled={loading} onClick={()=>void load(true)}><RefreshCw size={16} className={loading?'spinning':''}/>{loading?'正在扫描…':'刷新盘面'}</button></div></div>
    <form className="market-research-entry" onSubmit={event=>{event.preventDefault();const code=normalizeCode(researchCode);if(!code){setCodeError('请输入有效的沪深 A 股代码，如 000651。');return}setCodeError('');setResearch({code,name:data?.candidates.find(stock=>stock.code===code)?.name||watched.find(stock=>stock.code===code)?.name||code})}}><div><strong>用 Skill 再核查一遍</strong><p>量价、基本面、反向风险三种研究流程；盘面暂不可用时仍可按代码检查资料。</p></div><div><label className="sr-only" htmlFor="skill-stock-code">研究股票代码</label><input id="skill-stock-code" placeholder="股票代码，如 000651" value={researchCode} onChange={event=>{setResearchCode(event.target.value);setCodeError('')}} aria-invalid={!!codeError} aria-describedby={codeError?'skill-code-error':undefined}/><button className="button secondary" type="submit">打开 Skill 研究 <ArrowUpRight size={16}/></button></div>{codeError&&<p id="skill-code-error" className="form-error" role="alert">{codeError}</p>}</form>
    {error&&<div className="error-banner" role="alert"><Info size={18}/><span>{error}{data?' · 下方保留上次成功快照，请留意时间。':''}</span><button className="text-button" onClick={()=>void load(true)}>重试</button></div>}
    {loading&&!data?<div className="market-loading" role="status"><div className="scan-orbit"><ScanLine size={32}/></div><h2>正在扫描市场</h2><p>读取指数、领涨板块与成交活跃股票…</p><div className="skeleton-index-grid">{[1,2,3].map(i=><div className="skeleton" key={i}/>)}</div></div>:data&&<>
      <div className="market-meta"><span className={`live-indicator ${data.stale||error?'delayed':''}`}><i/>{data.stale||error?'快照 / 待更新':data.isToday?'当日行情快照':'历史行情快照'}</span><span><Clock3 size={13}/>{dateTime(data.asOf)}（北京时间）</span><span>扫描 {data.scannedCount} 只 · 公开行情可能延迟</span><label className="auto-refresh-label"><input type="checkbox" checked={auto} onChange={event=>setAuto(event.target.checked)}/>60 秒自动更新</label></div>
      <div className="index-grid">{data.indices.map(index=><div className="index-card" key={index.code}><div><span>{index.name}</span><span className="index-code">{index.code}</span></div><strong className={index.change===null?'':tone(index.change)}>{index.price===null?'—':number(index.price)}</strong><span className={`index-change ${index.change===null?'':tone(index.change)}`}>{signedPercent(index.change===null?null:index.change/100)}</span><small>成交额 {index.amount===null?'—':money(index.amount)}</small></div>)}</div>
      <div className={`market-stance ${data.weak?'cautious':''}`}><span className="stance-icon"><Activity size={22}/></span><div><strong>{data.stance}</strong><p>扫描样本：{data.breadth.rising} 只上涨 / {data.breadth.falling} 只下跌；范围为活跃池与部分热点成分，非全市场涨跌家数。</p></div><span className="stance-badge">{data.weak?'弱势观察':'量价观察'}</span></div>
      {data.warnings.map(message=><p className="market-warning" key={message}><Info size={15}/>{message}</p>)}
      <div className="market-workspace"><section className="panel hot-sectors"><div className="panel-heading"><div className="section-title"><Flame size={18}/><h2>领涨板块</h2></div><span className="muted small">当日涨幅排序</span></div><div className="sector-list">{data.sectors.map((item,index)=><div className="sector-item" key={item.code}><span className="sector-rank">{String(index+1).padStart(2,'0')}</span><div><strong>{item.name}</strong><span>领涨 {item.leader||'暂无数据'}</span></div><b className={tone(item.change)}>{signedPercent(item.change/100)}</b></div>)}{data.sectors.length===0&&<p className="muted">板块数据暂不可用</p>}</div><div className="sector-note"><Info size={15}/><p>热点强度会变化。候选结合成交与量价筛选，不直接追逐板块涨幅第一名。</p></div><details className="methodology"><summary>筛选规则与数据范围 <ChevronDown size={15}/></summary><p>{data.methodology.description}</p><ul>{data.methodology.filters.map(filter=><li key={filter}>{filter}</li>)}</ul><p>{data.methodology.scoring}</p></details></section>
      <section className="candidate-section"><div className="candidate-heading"><div><h2>短线观察候选 <span>{data.candidates.length}</span></h2><p>量价规则筛选 · 每只都有入选依据与风险提示</p></div><button className={`watch-filter ${onlyWatched?'active':''}`} aria-pressed={onlyWatched} onClick={()=>setOnlyWatched(value=>!value)}><Star size={16}/>{onlyWatched?'只看已观察':'我的观察'}<span>{watched.length}</span></button></div>
        <div className="filter-chips" role="group" aria-label="候选板块筛选"><button aria-pressed={sector==='all'} className={sector==='all'?'active':''} onClick={()=>setSector('all')}>全部候选</button>{availableSectors.map(name=><button key={name} aria-pressed={sector===name} className={sector===name?'active':''} onClick={()=>setSector(name)}>{name}</button>)}</div>
        {onlyWatched&&watched.length>0&&<div className="watchlist-tray"><div><Star size={15}/><strong>已保存的观察名单</strong><span>点击名称查看公司研究</span></div>{watched.map(stock=><div className="watchlist-row" key={stock.code}><button onClick={()=>setResearch(stock)}>{stock.name}<span>{stock.code}</span><ArrowUpRight size={14}/></button><button className="icon-button" aria-label={`移出观察${stock.name}`} onClick={()=>toggle(stock)}><X size={15}/></button></div>)}</div>}
        <div className="candidate-list">{rows.map(stock=>{
          const saved=watched.some(s=>s.code===stock.code)
          return <article className="candidate-card" key={stock.code}>
            <div className="candidate-top"><div className="candidate-identity"><span className="candidate-symbol">{stock.name.slice(0,1)}</span><div><h3>{stock.name}<span>{stock.sector?.name||stock.industry}</span></h3><p>{stock.code.slice(0,2)} {stock.code.slice(2)}</p></div></div><div className="candidate-price"><strong>{number(stock.price)}</strong><span className={tone(stock.change)}>{signedPercent(stock.change/100)}</span></div></div>
            <div className="candidate-metrics"><div><span>成交额</span><strong>{money(stock.amount)}</strong></div><div><span>量比</span><strong>{number(stock.volumeRatio)}<small> 倍</small></strong></div><div><span>换手率</span><strong>{number(stock.turnover)}<small>%</small></strong></div><div><span>规则匹配</span><strong>{stock.score}<small> / 100</small></strong></div></div>
            <div className="candidate-reason"><span className="signal-dot"/><p>{stock.sector?`${stock.sector.name}板块走强，${stock.volumeRatio.toFixed(1)} 倍量比配合`:'成交活跃，量价达到观察条件'}</p></div>
            <details className="candidate-details"><summary>入选依据与风险 <ChevronDown size={16}/></summary><div className="candidate-evidence"><div><h4>为什么入选</h4><ul>{stock.reasons.map(reason=><li key={reason}>{reason}</li>)}</ul></div><div><h4>需要警惕</h4><ul>{(data.weak?['大盘偏弱，个股相对强势未必能持续',...stock.risks]:stock.risks).map(risk=><li key={risk}>{risk}</li>)}</ul></div></div><p className="candidate-asof">行情时间：{dateTime(stock.asOf)} · 匹配分不是上涨概率</p></details>
            <div className="candidate-actions"><button className={`button ${saved?'observed':'secondary'}`} aria-pressed={saved} onClick={()=>observe(stock)}>{saved?<Check size={16}/>:<Star size={16}/>}<span>{saved?'已加入观察':'加入观察'}</span></button><button className="research-link" onClick={()=>setResearch(stock)}>基本面与 AI 研究 <ArrowUpRight size={17}/></button></div>
          </article>
        })}</div>
        {rows.length===0&&<div className="panel candidate-empty"><ScanLine size={30}/><h3>{onlyWatched?'当前候选中暂无已观察股票':'暂无符合条件的候选'}</h3><p>{onlyWatched?'关闭「我的观察」查看全部候选。观察名单不会随刷新自动删除。':'行情偏弱或条件未满足时保持空白，等待更清楚的量价信号。'}</p>{(sector!=='all'||onlyWatched)&&<button className="button secondary" onClick={()=>{setSector('all');setOnlyWatched(false)}}>重置筛选</button>}</div>}
      </section></div>
      <div className="market-footnote"><p>观察候选来自公开量价规则，未经回测，不代表上涨预测或买入指令。短线波动较大，请结合公告、承接与风险承受能力独立判断。</p><a href={data.source.url} target="_blank" rel="noreferrer">{data.source.name}<ExternalLink size={13}/></a></div>
    </>}
    {research&&<Modal wide title={`${research.name} · 公司研究`} subtitle="复核量价、基本面与资料缺口。观察名单与真实持仓相互独立。" onClose={()=>setResearch(null)}><SkillResearchPanel code={research.code}/><FundamentalsPanel holdings={[{input:{code:research.code,name:research.name,quantity:0,costPrice:0},quote:null,marketValue:0,pnl:0,pnlPercent:null,weight:0}]} demo={false} selectedCode={research.code} onSelect={()=>{}}/></Modal>}
    {notice&&<div className="toast" role="status"><Check size={17}/>{notice}<button className="icon-button" aria-label="关闭提示" onClick={()=>setNotice('')}><X size={16}/></button></div>}
  </main>
}
