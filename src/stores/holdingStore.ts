import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { HoldingInput } from '../types/holding'
import { normalizeCode } from '../lib/normalizeCode'
interface HoldingState {
  holdings:HoldingInput[]; storageError:boolean
  add:(h:HoldingInput)=>void; update:(code:string,h:HoldingInput)=>void; remove:(code:string)=>void
  fillNames:(names:Map<string,string>)=>void
}
export const useHoldingStore=create<HoldingState>()(persist((set)=>({
  holdings:[], storageError:false,
  add:h=>set(s=>({holdings:[...s.holdings.filter(x=>x.code!==h.code),h]})),
  update:(code,h)=>set(s=>({holdings:s.holdings.map(x=>x.code===code?h:x)})),
  remove:code=>set(s=>({holdings:s.holdings.filter(x=>x.code!==code)})),
  fillNames:names=>set(s=>({holdings:s.holdings.map(h=>!h.name&&names.has(h.code)?{...h,name:names.get(h.code)}:h)})),
}),{
  name:'a-share-holdings',version:1,
  partialize:s=>({holdings:s.holdings}),
  storage:{
    getItem:name=>{
      try { const raw=localStorage.getItem(name); return raw?JSON.parse(raw):null }
      catch { queueMicrotask(()=>useHoldingStore.setState({storageError:true})); return null }
    },
    setItem:(name,value)=>{
      try { localStorage.setItem(name,JSON.stringify(value)); queueMicrotask(()=>{ if(useHoldingStore.getState().storageError)useHoldingStore.setState({storageError:false}) }) }
      catch { queueMicrotask(()=>{if(!useHoldingStore.getState().storageError)useHoldingStore.setState({storageError:true})}) }
    },
    removeItem:name=>localStorage.removeItem(name),
  },
  merge:(persisted,current)=>{
    const data=persisted as {holdings?:unknown}|undefined
    const valid=Array.isArray(data?.holdings)?data.holdings.filter((h):h is HoldingInput=>
      !!h&&typeof h==='object'&&'code'in h&&typeof h.code==='string'&&normalizeCode(h.code)===h.code&&
      'quantity'in h&&typeof h.quantity==='number'&&Number.isSafeInteger(h.quantity)&&h.quantity>0&&
      'costPrice'in h&&typeof h.costPrice==='number'&&Number.isFinite(h.costPrice)&&h.costPrice>=0):[]
    return {...current,holdings:[...new Map(valid.map(h=>[h.code,{
      code:h.code,quantity:h.quantity,costPrice:h.costPrice,
      name:typeof h.name==='string'?h.name:undefined,
      industry:typeof h.industry==='string'?h.industry:undefined,
      buyDate:typeof h.buyDate==='string'?h.buyDate:undefined,
    }])).values()]}
  },
}))
