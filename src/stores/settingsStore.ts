import { create } from 'zustand'
import { createJSONStorage, persist } from 'zustand/middleware'
interface SettingsState { demo:boolean; autoRefresh:boolean; hideAmounts:boolean; setDemo:(v:boolean)=>void; setAutoRefresh:(v:boolean)=>void; toggleAmounts:()=>void }
export const useSettingsStore=create<SettingsState>()(persist(set=>({
  demo:false,autoRefresh:true,hideAmounts:false,
  setDemo:demo=>set({demo}),setAutoRefresh:autoRefresh=>set({autoRefresh}),toggleAmounts:()=>set(s=>({hideAmounts:!s.hideAmounts})),
}),{name:'a-share-settings',partialize:s=>({autoRefresh:s.autoRefresh,hideAmounts:s.hideAmounts}),
  storage:createJSONStorage(()=>({
    getItem:name=>{try{return localStorage.getItem(name)}catch{return null}},
    setItem:(name,value)=>{try{localStorage.setItem(name,value)}catch{/* Keep the interface usable when browser storage is full. */}},
    removeItem:name=>{try{localStorage.removeItem(name)}catch{/* Storage may be disabled. */}},
  })),
  merge:(persisted,current)=>{
    const saved=persisted as Partial<SettingsState>|null
    return {...current,autoRefresh:typeof saved?.autoRefresh==='boolean'?saved.autoRefresh:current.autoRefresh,
      hideAmounts:typeof saved?.hideAmounts==='boolean'?saved.hideAmounts:current.hideAmounts}
  },
}))
