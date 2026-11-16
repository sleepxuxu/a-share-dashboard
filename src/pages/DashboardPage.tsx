import { useState, lazy, Suspense } from 'react'
import { Link,useOutletContext } from 'react-router'
import { RefreshCw, Plus, ChevronRight, ShieldCheck, Upload, FlaskConical, X, CircleAlert, Check, Clock3, ArrowUpRight, CalendarDays,Compass } from 'lucide-react'
import { SummaryCards } from '../components/dashboard/SummaryCards'
import { HoldingTable } from '../components/dashboard/HoldingTable'
import { ConcentrationCard } from '../components/dashboard/ConcentrationCard'
import { HoldingForm } from '../components/holding/HoldingForm'
import { HoldingImport } from '../components/holding/HoldingImport'
import { Modal } from '../components/layout/Modal'
import { usePortfolioQuote } from '../hooks/usePortfolioQuote'
import { useSettingsStore } from '../stores/settingsStore'
import { useHoldingStore } from '../stores/holdingStore'
import type { HoldingInput } from '../types/holding'
import { clockTime } from '../lib/formatters'
import { FundamentalsPanel } from '../components/research/FundamentalsPanel'
const AllocationPie=lazy(()=>import('../components/dashboard/AllocationPie').then(m=>({default:m.AllocationPie})))
const IndustryBar=lazy(()=>import('../components/dashboard/IndustryBar').then(m=>({default:m.IndustryBar})))
export function DashboardPage(){
  const {onHelp}=useOutletContext<{onHelp:()=>void}>()
  const {snapshot,demo,loading,error,lastUpdated,staleCodes,refresh,autoRefresh}=usePortfolioQuote()
  const setDemo=useSettingsStore(s=>s.setDemo),storageError=useHoldingStore(s=>s.storageError)
  const [form,setForm]=useState<HoldingInput|true|null>(null),[deleting,setDeleting]=useState<HoldingInput|null>(null),[importing,setImporting]=useState(false)
  const [toast,setToast]=useState('')
  const [section,setSection]=useState('holdings')
  const [fundamentalCode,setFundamentalCode]=useState('')
  const inspect=(code:string)=>{setFundamentalCode(code);setSection('fundamentals');window.setTimeout(()=>document.getElementById('fundamentals')?.scrollIntoView({behavior:'smooth',block:'start'}),50)}
  const notify=(message:string)=>{setToast(message);window.setTimeout(()=>setToast(''),3500)}
  const add=()=>{setDemo(false);setForm(true)}
  return <main className="page"><div className="page-heading"><div><div className="eyebrow"><span/>YOUR PORTFOLIO</div><h1>我的持仓<span className="heading-dot">.</span></h1><p>盈亏看清楚，配置有分寸。研究从你的每一笔持仓开始。</p></div><div className="heading-actions"><span className="date-label"><CalendarDays size={14}/>{new Date().toLocaleDateString('zh-CN',{year:'numeric',month:'long',day:'numeric',timeZone:'Asia/Shanghai'})}</span><div className="heading-buttons"><button className="button secondary" onClick={()=>setImporting(true)}><Upload size={15}/>导入持仓</button><button className="button primary" onClick={add}><Plus size={17}/>添加持仓</button></div></div></div>
    {demo?<div className="demo-banner"><div><span className="demo-icon"><FlaskConical size={16}/></span><strong>正在浏览演示组合</strong><span>以下为固定示例数据，帮助你快速了解股见。</span></div><button onClick={()=>setDemo(false)}>使用我的持仓<ChevronRight size={15}/></button></div>:<div className="privacy-banner"><ShieldCheck size={15}/><span>你的投资记录仅保存在当前浏览器，安心记录，自在分析。</span><button onClick={()=>setDemo(true)}>查看演示<ArrowUpRight size={14}/></button></div>}
    <div className="overview-label"><div><span className="small-dot"/><h2>资产概览</h2><span className={`badge ${demo?'blue':'green'}`}>{demo?'示例数据':'我的组合'}</span></div><div className="refresh-status"><span>{demo?'行情为演示快照':loading?'正在获取行情…':lastUpdated?`${error?'最近数据':'更新于'} ${clockTime(lastUpdated)}`:snapshot.holdings.length?'等待行情更新':'暂无行情'}</span><button className="refresh-button" onClick={()=>{if(demo){notify('演示行情为固定示例，退出演示后可刷新真实行情。')}else void refresh()}} disabled={loading||(!demo&&!snapshot.holdings.length)}><RefreshCw size={13} className={loading?'spinning':''}/>刷新</button></div></div>
    {storageError&&<div className="error-banner" role="alert"><CircleAlert size={17}/>本地存储不可用，持仓可能无法保存。请及时导出备份。</div>}
    {!demo&&(error||snapshot.missingCount>0)&&<div className="error-banner" role="status"><CircleAlert size={17}/><span>{error??'部分行情尚未取得，缺失标的按成本暂估。'} 组合指标为暂估。</span></div>}
    <SummaryCards snapshot={snapshot}/>
    <div className="portfolio-next"><span className="portfolio-next-icon"><Compass size={23}/></span><div><strong>下一步，看市场正在交易什么</strong><p>热点板块、量价信号和短线候选，放在一起看。</p></div><Link to="/market">打开盘面选股 <ArrowUpRight size={19}/></Link></div>
    <nav className="portfolio-tabs" aria-label="持仓区域导航">{[['holdings','持仓明细'],['analysis','配置分析'],['fundamentals','公司研究']].map(([id,label])=><a key={id} href={`#${id}`} className={section===id?'active':''} aria-current={section===id?'location':undefined} onClick={()=>setSection(id)}>{label}</a>)}</nav>
    <HoldingTable snapshot={snapshot} demo={demo} staleCodes={staleCodes} onAdd={add} onEdit={setForm} onDelete={setDeleting} onDemo={()=>setDemo(true)} onInspect={inspect}/>
    <div className="analysis-heading" id="analysis"><div className="section-title"><h2>组合洞察</h2><span className="section-subtitle">不只关注收益，也看见结构</span></div><span className="muted small">基于当前持仓市值计算</span></div>
    <div className="analysis-grid"><Suspense fallback={<div className="panel chart-loading">正在加载配置图表…</div>}><AllocationPie snapshot={snapshot}/><IndustryBar snapshot={snapshot}/></Suspense><ConcentrationCard snapshot={snapshot} onHelp={onHelp}/></div>
    <FundamentalsPanel holdings={snapshot.holdings} demo={demo} selectedCode={fundamentalCode} onSelect={setFundamentalCode}/>
    <footer className="page-footer"><span><ShieldCheck size={13}/>数据存于本地 · 分析不构成投资建议</span><span>{demo?<><FlaskConical size={12}/>演示模式 · 非实时行情</>:<><Clock3 size={12}/>{autoRefresh?'每 30 秒自动刷新':'手动刷新模式'} · 第三方行情可能延迟</>}</span><span>用清晰，陪伴每一个投资决策</span></footer>
    {form&&<HoldingForm holding={form===true?undefined:form} onClose={()=>{setForm(null)}}/>}
    {deleting&&<Modal title="删除这笔持仓？" subtitle={`即将删除 ${deleting.name??deleting.code}（${deleting.code}）的持仓记录。`} onClose={()=>setDeleting(null)}><p className="delete-description">删除后会重新计算组合指标。你可以随时重新录入。</p><div className="modal-actions"><button className="button secondary" onClick={()=>setDeleting(null)}>保留持仓</button><button className="button danger-button" onClick={()=>{useHoldingStore.getState().remove(deleting.code);setDeleting(null);notify('持仓已删除')}}>确认删除</button></div></Modal>}
    {importing&&<HoldingImport onClose={()=>setImporting(false)} onImported={()=>{setDemo(false);notify('持仓导入成功')}}/>}
    {toast&&<div className="toast" role="status"><Check size={17}/>{toast}<button className="icon-button" onClick={()=>setToast('')} aria-label="关闭提示"><X size={14}/></button></div>}
  </main>
}
