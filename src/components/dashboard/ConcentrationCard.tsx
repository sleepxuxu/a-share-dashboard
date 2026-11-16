import { ShieldCheck, ArrowUpRight, Info } from 'lucide-react'
import type { PortfolioSnapshot } from '../../types/portfolio'
import { percent, number } from '../../lib/formatters'
export function ConcentrationCard({snapshot:s,onHelp}:{snapshot:PortfolioSnapshot;onHelp:()=>void}){
  const c=s.concentration,empty=s.holdings.length===0
  const style=c.level==='高度集中'?'danger':c.level==='集中'?'orange':c.level==='适中'?'amber':'green'
  const top=[...s.holdings].sort((a,b)=>b.weight-a.weight)[0]
  return <section className="panel concentration-panel"><div className="panel-heading"><div className="section-title"><ShieldCheck size={17}/><h2>集中度诊断</h2></div><button className="icon-button" onClick={onHelp} aria-label="查看集中度说明"><Info size={15}/></button></div>
    <div className="concentration-content"><div className="hhi-line"><div><span className="muted small">HHI 集中度指数</span><div className="hhi-value">{empty?'—':number(c.hhi,3)}<small>/ 1.000</small></div></div><span className={`risk-badge ${empty?'neutral':style}`}>{empty?'暂无持仓':c.level}</span></div>
      <div className="risk-meter"><div className="risk-pointer" style={{left:`${Math.min(c.hhi/.5,1)*100}%`}}/></div><div className="meter-labels"><span>分散</span><span>适中</span><span>集中</span><span>高度集中</span></div>
      <div className="concentration-stats"><div><span>Top 1 占比</span><strong>{empty?'—':percent(c.top1,1)}</strong></div><div><span>Top 3 占比</span><strong>{empty?'—':percent(c.top3,1)}</strong></div><div><span>Top 5 占比</span><strong>{empty?'—':percent(c.top5,1)}</strong></div><div><span>有效持仓数</span><strong>{empty?'—':number(c.effectiveN,1)}<small> 只</small></strong></div></div>
      <div className={`risk-insight ${empty?'':style}`}><ShieldCheck size={16}/><p>{empty?'添加持仓后，了解你的组合集中程度。':c.top1>=.25?`${top?.quote?.name??top?.input.name??top?.input.code}占比 ${percent(c.top1,1)}，单一标的波动对组合影响较大。`:c.hhi>=.15?'组合相对集中，可结合行业分布关注相关性风险。':'组合分散程度较好，继续关注标的之间的相关性。'}</p></div>
    </div><button className="panel-link" onClick={onHelp}>了解集中度指标 <ArrowUpRight size={14}/></button>
  </section>
}
