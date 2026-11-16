import { useEffect, useRef } from 'react'
export function useRefreshInterval(callback:()=>void,enabled:boolean,delay=30_000){
  const ref=useRef(callback)
  useEffect(()=>{ref.current=callback},[callback])
  useEffect(()=>{
    if(!enabled)return
    const tick=()=>{if(document.visibilityState==='visible')ref.current()}
    const timer=window.setInterval(tick,delay)
    document.addEventListener('visibilitychange',tick)
    return ()=>{window.clearInterval(timer);document.removeEventListener('visibilitychange',tick)}
  },[enabled,delay])
}
