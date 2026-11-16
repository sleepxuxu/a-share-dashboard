import { useState } from 'react'
import { ShieldCheck, RefreshCw, Monitor, ArrowLeft, Database } from 'lucide-react'
import { Link } from 'react-router'
import { useSettingsStore } from '../stores/settingsStore'
import { useHoldingStore } from '../stores/holdingStore'
import { HoldingImport } from '../components/holding/HoldingImport'
import { AiSettings } from '../components/research/AiSettings'
export function SettingsPage(){
  const settings=useSettingsStore(),count=useHoldingStore(s=>s.holdings.length)
  const [importing,setImporting]=useState(false)
  return <main className="page settings-page"><Link to="/" className="back-link"><ArrowLeft size={16}/>返回资产总览</Link><div className="page-heading"><div><h1>偏好设置</h1><p>按你的方式，管理投资工作台。</p></div></div>
    <section className="panel settings-panel"><div className="panel-heading"><div className="section-title"><RefreshCw size={18}/><h2>行情与显示</h2></div></div>
    <div className="setting-row"><div><strong>自动刷新行情</strong><p>每 30 秒更新一次，页面进入后台时暂停；回到页面立即检查行情。</p></div><button role="switch" aria-checked={settings.autoRefresh} aria-label="自动刷新行情" className={`toggle ${settings.autoRefresh?'on':''}`} onClick={()=>settings.setAutoRefresh(!settings.autoRefresh)}><span/></button></div>
    <div className="setting-row"><div><strong>隐藏持仓金额</strong><p>隐藏概览金额以及表格中的股数、成本、市值与盈亏。</p></div><button role="switch" aria-checked={settings.hideAmounts} aria-label="隐藏持仓金额" className={`toggle ${settings.hideAmounts?'on':''}`} onClick={settings.toggleAmounts}><span/></button></div>
    <div className="setting-row"><div><strong>演示模式</strong><p>使用固定示例查看功能。演示数字有明确标记，真实持仓独立保留。</p></div><button role="switch" aria-checked={settings.demo} aria-label="演示模式" className={`toggle ${settings.demo?'on':''}`} onClick={()=>settings.setDemo(!settings.demo)}><span/></button></div></section>
    <section className="panel settings-panel"><div className="panel-heading"><div className="section-title"><Database size={18}/><h2>本地数据</h2></div><span className="small muted">{count} 条真实持仓</span></div><div className="setting-row"><div><strong>恢复或合并持仓</strong><p>从 CSV 文件导入。可在导入前预览，重复代码会提示覆盖。</p></div><button className="button secondary" onClick={()=>setImporting(true)}>导入持仓</button></div><div className="setting-row"><div><strong>行业分类</strong><p>使用内置常见股票映射；未覆盖归入「其他」，可在持仓编辑中手动指定。</p></div><span className="badge blue">静态分类</span></div></section>
    <AiSettings/>
    <div className="settings-info"><ShieldCheck size={21}/><div><strong>本地优先的持仓分析工具</strong><p>持仓保存于当前浏览器。建议定期导出 CSV 备份；清理浏览器数据会移除持仓。公开基本面由本机研究服务获取，AI 按需调用所选服务商，不发送持仓数量或成本。</p></div></div><div className="settings-version"><Monitor size={14}/>股见 · v0.2.0 · 基本面与 AI 研究</div>
    {importing&&<HoldingImport onClose={()=>setImporting(false)} onImported={()=>settings.setDemo(false)}/>}
  </main>
}
