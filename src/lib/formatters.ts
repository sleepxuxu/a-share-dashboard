export const number = (v: number, digits=2) => new Intl.NumberFormat('zh-CN',{minimumFractionDigits:digits,maximumFractionDigits:digits}).format(v)
export const money = (v: number) => number(v)
export const signed = (v: number) => `${v>0?'+':v<0?'-':''}${number(Math.abs(v))}`
export const percent = (v: number|null, digits=2) => v===null?'—':`${number(v*100,digits)}%`
export const signedPercent = (v: number|null) => v===null?'—':`${v>0?'+':''}${percent(v)}`
export const tone = (v: number) => v>0?'up':v<0?'down':'neutral'
export const clockTime = (v: number) => new Date(v).toLocaleTimeString('zh-CN',{hour12:false})
