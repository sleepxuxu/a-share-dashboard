import { useEffect,useRef,useState } from 'react'
import { Link } from 'react-router'
import { BookOpen,ClipboardCheck,RefreshCw,Sparkles,ExternalLink } from 'lucide-react'
import { fetchResearchSkills,fetchAiConfig,analyzeWithSkill } from '../../services/researchService'
import type { AiConfig,AiProvider } from '../../types/fundamentals'
import type { ResearchSkill,ResearchSkillId,SkillResearch } from '../../types/research'
const time=(value:string)=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false})

export function SkillResearchPanel({code}:{code:string}){
  const [skills,setSkills]=useState<ResearchSkill[]>([]),[skill,setSkill]=useState<ResearchSkillId>('tape')
  const [config,setConfig]=useState<AiConfig|null>(null),[provider,setProvider]=useState<AiProvider>('deepseek')
  const [result,setResult]=useState<SkillResearch|null>(null),[error,setError]=useState(''),[catalogError,setCatalogError]=useState('')
  const [busy,setBusy]=useState(false),[catalogVersion,setCatalogVersion]=useState(0)
  const request=useRef<AbortController|null>(null)
  useEffect(()=>{
    const controller=new AbortController();setCatalogError('')
    void fetchResearchSkills(controller.signal).then(data=>setSkills(data.skills)).catch(e=>{if(!controller.signal.aborted)setCatalogError(e.message)})
    void fetchAiConfig().then(data=>{if(!controller.signal.aborted){setConfig(data);const ready=data.providers.find(p=>p.configured);if(ready)setProvider(ready.id)}}).catch(()=>{})
    return()=>controller.abort()
  },[catalogVersion])
  useEffect(()=>{setResult(null);setError('');setBusy(false);return()=>request.current?.abort()},[code,skill,provider])
  async function analyze(mode:'checks'|'ai'){
    const controller=new AbortController();request.current=controller;setBusy(true);setError('');setResult(null)
    try{const data=await analyzeWithSkill(code,skill,mode,provider,controller.signal);if(!controller.signal.aborted)setResult(data)}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'研究未完成，请重试。')}
    finally{if(!controller.signal.aborted)setBusy(false)}
  }
  const selected=skills.find(item=>item.id===skill),configured=config?.providers.find(item=>item.id===provider)?.configured
  return <section className="panel skill-research-panel" aria-label="Skill 研究">
    <div className="panel-heading"><div className="section-title"><BookOpen size={19}/><h2>Skill 研究</h2></div><span className="badge blue">项目自定义流程</span></div>
    <div className="skill-research-body"><p className="skill-intro">量价规则先筛候选，再按研究流程复核证据。Skill 是分析步骤与约束，不是行情源或已验证的选股策略。</p>
      {catalogError&&<div className="error-banner" role="alert">{catalogError}<button className="text-button" onClick={()=>setCatalogVersion(value=>value+1)}>重试加载 Skill</button></div>}
      <div className="skill-selector" role="group" aria-label="研究流程">{skills.map(item=><button key={item.id} className={skill===item.id?'active':''} aria-pressed={skill===item.id} disabled={busy} onClick={()=>setSkill(item.id)}><strong>{item.name}</strong><span>{item.description}</span></button>)}</div>
      {selected&&<details className="skill-instructions"><summary>查看 Skill 内容与版本 · {selected.version}</summary><p>{selected.origin}</p><pre>{selected.instructions}</pre></details>}
      <div className="skill-actions"><button className="button secondary" disabled={busy||!selected} onClick={()=>void analyze('checks')}><ClipboardCheck size={16}/>运行资料检查</button><div><select aria-label="Skill 分析模型" value={provider} disabled={busy} onChange={event=>setProvider(event.target.value as AiProvider)}><option value="deepseek">DeepSeek</option><option value="ark">火山方舟</option></select><button className="button primary" disabled={busy||!selected||!configured} onClick={()=>void analyze('ai')}><Sparkles size={16}/>按 Skill 生成 AI 解读</button></div></div>
      <p className="skill-data-note">资料检查通过固定规则检查公开数据，无需模型。AI 解读按需调用所选模型并消耗服务商额度，不发送你的股数、成本或盈亏。</p>
      {!configured&&<p className="ai-config-hint">所选模型尚未配置，仍可运行资料检查。<Link to="/settings#ai-settings">接入模型 →</Link></p>}
      {busy&&<div className="research-loading" role="status"><RefreshCw size={17} className="spinning"/>正在收集公开证据并复核…<button className="text-button" onClick={()=>{request.current?.abort();setBusy(false)}}>取消等待</button></div>}
      {error&&<div className="error-banner" role="alert">{error}</div>}
      {result&&<div className="skill-result" aria-live="polite"><div className="skill-result-meta"><strong>{result.skill.name} · {result.mode==='ai'?'AI 解读':'规则资料检查'}</strong><span>生成于 {time(result.generatedAt)}（北京时间）</span><span>行情：{result.marketAsOf?time(result.marketAsOf):'未取得'} · 财报截止：{result.reportDate||'未取得'}</span>{result.mode==='ai'&&<span>{result.provider} · {result.model}</span>}</div>
        <div className="skill-checks">{result.checks.map((check,index)=><div className={`skill-check ${check.level}`} key={index}><span>{check.level==='caution'?'需警惕':check.level==='missing'?'待核实':'事实'}</span><div><strong>{check.label}</strong><p>{check.detail}</p></div></div>)}</div>
        {result.content&&<div className="analysis-prose">{result.content.split('\n').filter(line=>line.trim()).map((line,index)=>/^#{1,6}\s/.test(line)?<h3 key={index}>{line.replace(/^#{1,6}\s+|\*\*/g,'')}</h3>:<p key={index}>{line.replace(/\*\*/g,'')}</p>)}</div>}
        <div className="skill-gaps"><h3>资料缺口</h3><ul>{result.gaps.map(gap=><li key={gap}>{gap}</li>)}</ul></div>
        <div className="source-links">{result.sources.map(source=><a key={source.url} href={source.url} target="_blank" rel="noreferrer">{source.name}<ExternalLink size={13}/></a>)}</div>
      </div>}
    </div>
  </section>
}
