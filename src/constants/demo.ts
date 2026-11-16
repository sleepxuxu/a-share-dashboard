import type { HoldingInput } from '../types/holding'
import type { Quote } from '../types/quote'
export const DEMO_HOLDINGS: HoldingInput[] = [
  {code:'SH600519',name:'贵州茅台',quantity:200,costPrice:1420},
  {code:'SZ300750',name:'宁德时代',quantity:800,costPrice:235},
  {code:'SH600036',name:'招商银行',quantity:4000,costPrice:35.6},
  {code:'SZ000333',name:'美的集团',quantity:1600,costPrice:64.5},
  {code:'SH601899',name:'紫金矿业',quantity:5000,costPrice:17.2},
  {code:'SH600900',name:'长江电力',quantity:3000,costPrice:28.5},
  {code:'SH600276',name:'恒瑞医药',quantity:1400,costPrice:46.8},
  {code:'SH688981',name:'中芯国际',quantity:600,costPrice:92.5},
]
const values = [[1518,1505],[258.6,255.4],[39.82,40.16],[73.18,72.55],[20.35,20.08],[27.62,27.8],[53.12,52.6],[96.45,97.32]]
export const DEMO_QUOTES = new Map<string,Quote>(DEMO_HOLDINGS.map((h,i)=>{
  const [price,yesterday]=values[i]
  return [h.code,{code:h.code,name:h.name!,price,yesterday,percent:(price-yesterday)/yesterday*100,low:price*.99,high:price*1.01,source:'demo'}]
}))
