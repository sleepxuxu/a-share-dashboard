import { useEffect,useRef,useState } from 'react'
import { Link } from 'react-router'
import { BookOpen,ExternalLink,RefreshCw,Sparkles,FileText,Info } from 'lucide-react'
import type { HoldingSnapshot } from '../../types/portfolio'
import type { AiAnalysis,AiConfig,AiProvider,Fundamentals } from '../../types/fundamentals'
import { fetchFundamentals,fetchAiConfig,analyzeFundamentals } from '../../services/researchService'
import { number } from '../../lib/formatters'

const amount=(value:number|null)=>value===null?'—':Math.abs(value)>=1e8?`${number(value/1e8)} 亿元`:`${number(value/1e4)} 万元`
const ratio=(value:number|null)=>value===null?'—':`${number(value)}%`
const metric=(value:number|null,suffix='')=>value===null?'—':`${number(value)}${suffix}`

function AnalysisText({content}:{content:string}){
  return <div className="analysis-prose">{content.split('\n').map((line,index)=>{
    const text=line.replace(/\*\*/g,'')
    return /^#{1,6}\s/.test(text)?<h3 key={index}>{text.replace(/^#{1,6}\s+/,'')}</h3>:text.trim()?<p key={index}>{text}</p>:null
  })}</div>
}

export function FundamentalsPanel({holdings,demo,selectedCode,onSelect}:{holdings:HoldingSnapshot[];demo:boolean;selectedCode:string;onSelect:(code:string)=>void}){
  const code=holdings.some(h=>h.input.code===selectedCode)?selectedCode:holdings[0]?.input.code||''
  const [requested,setRequested]=useState(false)
  const [data,setData]=useState<Fundamentals|null>(null)
  const [loading,setLoading]=useState(false),[error,setError]=useState(''),[version,setVersion]=useState(0)
  const [config,setConfig]=useState<AiConfig|null>(null),[provider,setProvider]=useState<AiProvider>('deepseek')
  const [analysis,setAnalysis]=useState<AiAnalysis|null>(null),[analyzing,setAnalyzing]=useState(false),[aiError,setAiError]=useState('')
  const analysisRequest=useRef<AbortController|null>(null)
  const enabled=!demo||requested
  useEffect(()=>{let active=true;void fetchAiConfig().then(value=>{if(active)setConfig(value)}).catch(()=>{});return()=>{active=false}},[])
  useEffect(()=>{
    const controller=new AbortController()
    analysisRequest.current?.abort();setAnalyzing(false);setAnalysis(null);setAiError('');setData(null);setError('')
    if(!code||!enabled){setLoading(false);return}
    setLoading(true)
    void fetchFundamentals(code,controller.signal,version>0).then(value=>{if(!controller.signal.aborted)setData(value)})
      .catch(e=>{if(!controller.signal.aborted)setError(e.message)})
      .finally(()=>{if(!controller.signal.aborted)setLoading(false)})
    return()=>{controller.abort();analysisRequest.current?.abort()}
  },[code,enabled,demo,version])
  const currentProvider=config?.providers.find(item=>item.id===provider)
  async function analyze(){
    const controller=new AbortController();analysisRequest.current=controller
    setAnalyzing(true);setAiError('');setAnalysis(null)
    try{const result=await analyzeFundamentals(code,provider,controller.signal);if(!controller.signal.aborted)setAnalysis(result)}
    catch(e){if(!controller.signal.aborted)setAiError(e instanceof Error?e.message:'分析未完成，请重试。')}
    finally{if(!controller.signal.aborted)setAnalyzing(false)}
  }
  const report=data?.reports[0]
  const holding=holdings.find(h=>h.input.code===code)
  const hasData=!!data&&(!!report||!!data.valuation)
  return <section className="panel fundamentals-panel" id="fundamentals">
    <div className="panel-heading research-heading"><div className="section-title"><BookOpen size={20}/><h2>持仓基本面</h2><span className="section-subtitle">先看经营，再看价格</span></div>
      {code&&<div className="research-controls"><label className="sr-only" htmlFor="fundamental-stock">选择研究股票</label><select id="fundamental-stock" value={code} onChange={event=>onSelect(event.target.value)}>{holdings.map(h=><option key={h.input.code} value={h.input.code}>{h.quote?.name||h.input.name||h.input.code} · {h.input.code}</option>)}</select><button className="button secondary compact" onClick={()=>setVersion(v=>v+1)} disabled={loading||!enabled}><RefreshCw size={15} className={loading?'spinning':''}/>更新财报</button></div>}
    </div>
    {!code?<div className="research-empty"><FileText size={30}/><h3>为持仓补上公司的经营视角</h3><p>添加持仓后，可查看每家公司的财务指标，并用 AI 辅助解读。</p></div>:!enabled?<div className="research-empty"><FileText size={30}/><h3>看看这些公司的基本面</h3><p>当前持仓与行情为演示数据。点击后单独加载所选公司的真实公开财报。</p><button className="button secondary" onClick={()=>setRequested(true)}>加载公开基本面</button></div>:<div className="research-body">
      <div className="company-research-heading"><div><h3>{data?.name&&data.name!==code?data.name:holding?.quote?.name||holding?.input.name||code}<span>{code}</span></h3><p>{report?`${report.period} · 报告截止 ${report.reportDate} · 公告日期 ${report.publishedAt||'未提供'}`:'财务数据按最新披露报告展示'}</p></div><span className="badge blue">公开财报</span></div>
      {demo&&<div className="form-note"><Info size={17}/>以下基本面来自真实公开数据，与演示持仓、演示行情分别展示。</div>}
      {loading&&<div className="research-loading" role="status"><RefreshCw size={20} className="spinning"/>正在读取公开财报与估值…</div>}
      {error&&<div className="error-banner" role="alert">{error}<button className="text-button" onClick={()=>setVersion(v=>v+1)}>重试</button></div>}
      {data?.warnings.map(message=><div key={message} className="form-note">{message}</div>)}
      {hasData&&<>
        <div className="fundamental-metrics">
          <div><span>营业总收入</span><strong>{amount(report?.revenue??null)}</strong><small>同比 {ratio(report?.revenueGrowth??null)}</small></div>
          <div><span>归母净利润</span><strong>{amount(report?.netProfit??null)}</strong><small>同比 {ratio(report?.profitGrowth??null)}</small></div>
          <div><span>净资产收益率 ROE</span><strong>{ratio(report?.roe??null)}</strong><small>加权口径 · 报告期累计</small></div>
          <div><span>经营活动现金流净额</span><strong>{amount(report?.operatingCashFlow??null)}</strong><small>报告期累计</small></div>
          <div><span>市盈率 PE（TTM）</span><strong>{metric(data.valuation?.peTtm??null,' 倍')}</strong><small>滚动市盈率</small></div>
          <div><span>市净率 PB</span><strong>{metric(data.valuation?.pb??null,' 倍')}</strong><small>市价与账面净资产之比</small></div>
          <div><span>资产负债率</span><strong>{ratio(report?.debtRatio??null)}</strong><small>报告期末</small></div>
          <div><span>销售净利率</span><strong>{ratio(report?.netMargin??null)}</strong><small>报告期累计</small></div>
        </div>
        <p className="report-basis">营收、利润和现金流为年初至报告期末累计值；同比与上年同期比较。金融行业指标口径有所不同，缺失项显示「—」。估值为采集时的行情快照，不能直接据此判断贵或便宜。</p>
        {data.reports.length>0&&<details className="report-history"><summary>查看最近 {data.reports.length} 期财报</summary><div className="table-scroll"><table><thead><tr><th>报告期（累计）</th><th>营收</th><th>营收同比</th><th>归母净利润</th><th>利润同比</th><th>ROE</th></tr></thead><tbody>{data.reports.map(item=><tr key={item.reportDate}><td>{item.period}</td><td>{amount(item.revenue)}</td><td>{ratio(item.revenueGrowth)}</td><td>{amount(item.netProfit)}</td><td>{ratio(item.profitGrowth)}</td><td>{ratio(item.roe)}</td></tr>)}</tbody></table></div></details>}
      </>}
      {data&&<div className="research-sources"><span>数据来源：东方财富 · 采集于 {new Date(data.fetchedAt).toLocaleString('zh-CN',{hour12:false})}</span><div className="source-links">{data.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name}<ExternalLink size={13}/></a>)}</div></div>}
      <div className="ai-research-card"><div className="ai-research-heading"><div><h3><Sparkles size={19}/>AI 基本面解读</h3><p>结合经营、现金流与估值，梳理值得继续研究的问题。</p></div><div className="ai-actions"><select aria-label="分析模型" value={provider} disabled={analyzing} onChange={event=>{setProvider(event.target.value as AiProvider);setAnalysis(null);setAiError('')}}><option value="deepseek">DeepSeek</option><option value="ark">火山方舟</option></select><button className="button primary" onClick={()=>void analyze()} disabled={!report||analyzing||!currentProvider?.configured}>{analyzing?<RefreshCw size={16} className="spinning"/>:<Sparkles size={16}/>}{analyzing?'正在分析…':'生成分析'}</button></div></div>
        {!currentProvider?.configured&&<p className="ai-config-hint">{currentProvider?.name||'模型'}尚未配置。<Link to="/settings#ai-settings">前往偏好设置接入模型 →</Link></p>}
        <p className="ai-data-note">仅分析公开财报与估值，不发送你的股数、买入成本或持仓金额。点击后会调用所选模型并消耗服务商额度。</p>
        {analyzing&&<div className="research-loading" role="status">正在分析 {data?.name||code} 的公开基本面…<button className="text-button" onClick={()=>{analysisRequest.current?.abort();setAnalyzing(false)}}>取消等待</button></div>}
        {aiError&&<p className="form-error" role="alert">{aiError}</p>}
        {analysis&&<div className="ai-result"><div className="ai-result-meta">{analysis.provider} · {analysis.model} · 财报截至 {analysis.reportDate} · {new Date(analysis.generatedAt).toLocaleString('zh-CN',{hour12:false})}</div><AnalysisText content={analysis.content}/><p className="ai-result-disclaimer">AI 可能存在遗漏或误读，请对照上方原始财报核实。分析不构成投资建议。</p></div>}
      </div>
    </div>}
  </section>
}
