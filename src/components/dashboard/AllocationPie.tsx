import { useMemo } from 'react'
import { ChartPie, Info } from 'lucide-react'
import { EChart } from '../charts/EChart'
import { CHART_COLORS } from '../../constants/industryMap'
import type { PortfolioSnapshot } from '../../types/portfolio'
import { percent } from '../../lib/formatters'
export function AllocationPie({snapshot:s}:{snapshot:PortfolioSnapshot}){
  const data=useMemo(()=>{
    const sorted=s.holdings.filter(h=>h.marketValue>0).sort((a,b)=>b.marketValue-a.marketValue)
    const items=sorted.slice(0,7).map((h,i)=>({name:h.quote?.name??h.input.name??h.input.code,value:h.marketValue,weight:h.weight,itemStyle:{color:CHART_COLORS[i%8]}}))
    if(sorted.length>7)items.push({name:'其他持仓',value:sorted.slice(7).reduce((t,h)=>t+h.marketValue,0),weight:sorted.slice(7).reduce((t,h)=>t+h.weight,0),itemStyle:{color:CHART_COLORS[7]}})
    return items
  },[s.holdings])
  const option=useMemo(()=>({animationDuration:650,tooltip:{trigger:'item',formatter:'{b}<br/>持仓占比 <b>{d}%</b>',borderWidth:0,textStyle:{fontSize:14}},series:[{type:'pie',radius:['66%','86%'],center:['50%','50%'],startAngle:90,padAngle:2,itemStyle:{borderRadius:4},label:{show:false},emphasis:{scaleSize:4},data}]}),[data])
  return <section className="panel allocation-panel"><div className="panel-heading"><div className="section-title"><ChartPie size={17}/><h2>持仓配置</h2></div><Info size={15} className="muted"/></div>{s.totalMarketValue>0?<div className="allocation-content"><div className="donut-wrap"><EChart option={option} height={208} label={`持仓配置环形图，${s.holdings.length}只股票`}/><div className="donut-center"><strong>{s.holdings.length}</strong><span>持仓标的</span></div></div><div className="allocation-legend">{data.map(d=><div key={d.name}><span className="legend-dot" style={{background:d.itemStyle.color}}/><span>{d.name}</span><strong>{percent(d.weight,1)}</strong></div>)}</div></div>:<div className="chart-empty"><ChartPie size={35} strokeWidth={1}/><p>添加持仓后查看资产配置</p></div>}<div className="panel-note">按持仓市值计算 · 长尾持仓合并展示</div></section>
}
