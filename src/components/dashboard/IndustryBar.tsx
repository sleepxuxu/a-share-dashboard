import { useMemo } from 'react'
import { ChartNoAxesCombined } from 'lucide-react'
import { EChart } from '../charts/EChart'
import type { PortfolioSnapshot } from '../../types/portfolio'
import { CHART_COLORS } from '../../constants/industryMap'
import { percent } from '../../lib/formatters'
export function IndustryBar({snapshot:s}:{snapshot:PortfolioSnapshot}){
  const items=useMemo(()=>{
    const top=s.industryWeights.slice(0,5)
    const rest=s.industryWeights.slice(5)
    if(rest.length)top.push({name:'其余行业',weight:rest.reduce((n,i)=>n+i.weight,0),marketValue:rest.reduce((n,i)=>n+i.marketValue,0),count:rest.reduce((n,i)=>n+i.count,0)})
    return top
  },[s.industryWeights])
  const option=useMemo(()=>({animationDuration:650,grid:{left:86,right:57,top:10,bottom:8},tooltip:{trigger:'axis',axisPointer:{type:'none'},valueFormatter:(v:unknown)=>`${Number(v).toFixed(1)}%`,textStyle:{fontSize:14}},
    xAxis:{type:'value',show:false,max:Math.max(...items.map(i=>i.weight*100),1)*1.16},yAxis:{type:'category',inverse:true,data:items.map(i=>i.name),axisTick:{show:false},axisLine:{show:false},axisLabel:{color:'#647084',fontSize:13}},
    series:[{type:'bar',barWidth:10,showBackground:true,backgroundStyle:{color:'#f4f6fa',borderRadius:3},itemStyle:{borderRadius:3},label:{show:true,position:'right',distance:10,color:'#4c5669',fontSize:13,formatter:'{c}%'},data:items.map((i,index)=>({value:Number((i.weight*100).toFixed(1)),itemStyle:{color:CHART_COLORS[index%8]}}))}]}),[items])
  return <section className="panel industry-panel"><div className="panel-heading"><div className="section-title"><ChartNoAxesCombined size={17}/><h2>行业分布</h2></div><span className="muted small">{s.industryWeights.length} 个行业</span></div>{s.totalMarketValue>0?<><EChart option={option} height={208} label={items.map(i=>`${i.name}${percent(i.weight,1)}`).join('，')}/><div className="panel-note">静态行业分类 · 未覆盖标的归入「其他」</div></>:<><div className="chart-empty"><ChartNoAxesCombined size={35} strokeWidth={1}/><p>你的行业分布将在这里呈现</p></div><div className="panel-note">静态行业映射，可在持仓中手动调整</div></>}</section>
}
