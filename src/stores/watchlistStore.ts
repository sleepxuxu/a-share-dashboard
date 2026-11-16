import { create } from 'zustand'
import { createJSONStorage,persist } from 'zustand/middleware'
interface WatchStock {code:string;name:string;addedAt:string}
interface WatchlistState {stocks:WatchStock[];toggle:(stock:{code:string;name:string})=>void}
export const useWatchlistStore=create<WatchlistState>()(persist(set=>({stocks:[],toggle:stock=>set(state=>({stocks:state.stocks.some(s=>s.code===stock.code)?state.stocks.filter(s=>s.code!==stock.code):[...state.stocks,{...stock,addedAt:new Date().toISOString()}]}))}),{
  name:'a-share-watchlist',
  partialize:state=>({stocks:state.stocks}),
  storage:createJSONStorage(()=>({getItem:key=>{try{return localStorage.getItem(key)}catch{return null}},setItem:(key,value)=>{try{localStorage.setItem(key,value)}catch{/* Keep in-memory observation available. */}},removeItem:key=>{try{localStorage.removeItem(key)}catch{/* Storage may be disabled. */}}})),
  merge:(saved,current)=>{
    const data=saved as {stocks?:unknown}|undefined
    return {...current,stocks:Array.isArray(data?.stocks)?data.stocks.filter((item):item is WatchStock=>!!item&&typeof item==='object'&&typeof item.code==='string'&&/^(SH6\d{5}|SZ[03]\d{5})$/.test(item.code)&&typeof item.name==='string'&&typeof item.addedAt==='string'):[]}
  },
}))
