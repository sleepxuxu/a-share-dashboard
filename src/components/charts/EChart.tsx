import { useEffect, useRef } from 'react'
import { init, use, type EChartsCoreOption } from 'echarts/core'
import { PieChart, BarChart } from 'echarts/charts'
import { GridComponent, TooltipComponent, AriaComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
use([PieChart,BarChart,GridComponent,TooltipComponent,AriaComponent,CanvasRenderer])
// use-echarts-react 1.0.2 imports all of echarts; this lifecycle keeps tree-shaking.
export function EChart({option,height=240,label}:{option:EChartsCoreOption;height?:number;label:string}){
  const ref=useRef<HTMLDivElement>(null)
  const chart=useRef<ReturnType<typeof init>|null>(null)
  useEffect(()=>{
    if(!ref.current)return
    const instance=init(ref.current,undefined,{renderer:'canvas'})
    chart.current=instance
    const observer=new ResizeObserver(()=>instance.resize())
    observer.observe(ref.current)
    return ()=>{observer.disconnect();instance.dispose();chart.current=null}
  },[])
  useEffect(()=>{chart.current?.setOption({...option,aria:{enabled:true,label:{description:label}}},true)},[option,label])
  return <div ref={ref} style={{height,width:'100%'}} role="img" aria-label={label}/>
}
