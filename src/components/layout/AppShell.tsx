import type { ReactNode } from 'react'
import { NavLink } from 'react-router'
import { ChartNoAxesCombined,Wallet,Compass,Settings2,CircleHelp,ArrowUpRight,ShieldCheck,Target,Sunset } from 'lucide-react'
export function AppShell({children,onHelp}:{children:ReactNode;onHelp:()=>void}){
  return <div className="app-shell"><header className="global-header">
    <NavLink to="/" className="brand" aria-label="股见首页"><span className="brand-symbol"><ChartNoAxesCombined size={23}/></span><strong>股见<span>GUJIAN</span></strong></NavLink>
    <nav className="primary-nav" aria-label="主导航">
      <NavLink to="/" end className={({isActive})=>`primary-nav-item ${isActive?'active':''}`}><Wallet size={18}/><span>我的持仓</span></NavLink>
      <NavLink to="/market" className={({isActive})=>`primary-nav-item ${isActive?'active':''}`}><Compass size={18}/><span>盘面选股</span><span className="new-dot"/></NavLink>
      <NavLink to="/tail-selection" className={({isActive})=>`primary-nav-item ${isActive?'active':''}`}><Sunset size={18}/><span>尾盘选股</span></NavLink>
      <NavLink to="/auction" className={({isActive})=>`primary-nav-item ${isActive?'active':''}`}><Target size={18}/><span>竞价选股</span></NavLink>
      <NavLink to="/settings" className={({isActive})=>`primary-nav-item ${isActive?'active':''}`}><Settings2 size={18}/><span>偏好设置</span></NavLink>
    </nav>
    <div className="header-end"><span className="local-status"><ShieldCheck size={14}/>持仓本地保存</span><button className="icon-button" onClick={onHelp} aria-label="帮助中心"><CircleHelp size={20}/></button></div>
  </header><div className="main-shell">{children}<footer className="site-footer"><span>股见 · 让每个判断有据可循</span><button onClick={onHelp}>指标与数据说明 <ArrowUpRight size={13}/></button></footer></div></div>
}
