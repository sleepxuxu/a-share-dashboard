import { useState } from 'react'
import { Outlet } from 'react-router'
import { AppShell } from './components/layout/AppShell'
import { HelpDialog } from './components/layout/HelpDialog'
export default function App(){
  const [help,setHelp]=useState(false)
  return <AppShell onHelp={()=>setHelp(true)}><Outlet context={{onHelp:()=>setHelp(true)}}/>{help&&<HelpDialog onClose={()=>setHelp(false)}/>}</AppShell>
}
