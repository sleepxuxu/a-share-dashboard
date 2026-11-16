import { Wallet, TrendingUp, ArrowUpRight, Layers3, Eye, EyeOff, Info } from 'lucide-react'
import type { PortfolioSnapshot } from '../../types/portfolio'
import { number, signed, signedPercent, tone } from '../../lib/formatters'
import { useSettingsStore } from '../../stores/settingsStore'
export function SummaryCards({snapshot:s}:{snapshot:PortfolioSnapshot}){
  const hidden=useSettingsStore(x=>x.hideAmounts),toggle=useSettingsStore(x=>x.toggleAmounts)
  return <div className="summary-grid">
    <section className="summary-card total-card"><div className="card-label"><span>持仓总市值 <span className="unit">CNY</span></span><button className="icon-button" onClick={toggle} aria-label={hidden?'显示金额':'隐藏金额'}>{hidden?<EyeOff size={16}/>:<Eye size={16}/>}</button></div><div className="summary-value"><small>¥</small>{hidden?'••••••':number(s.totalMarketValue)}</div><div className="card-foot">总投入成本 <span>{hidden?'••••••':`¥ ${number(s.totalCost)}`}</span></div><Wallet className="card-watermark" size={76} strokeWidth={1}/></section>
    <section className="summary-card"><div className="card-label"><span>累计持仓盈亏</span><TrendingUp size={17}/></div><div className={`summary-value ${tone(s.totalPnl)}`}>{hidden?'••••••':signed(s.totalPnl)}</div><div className="card-foot"><span className={`stat-pill ${tone(s.totalPnl)}`}><ArrowUpRight size={12}/>{hidden?'••••':signedPercent(s.totalPnlPercent)}</span><span>持仓收益率</span></div></section>
    <section className="summary-card"><div className="card-label"><span>今日持仓盈亏</span><Info size={16}/></div><div className={`summary-value ${tone(s.todayPnl)}`}>{hidden?'••••••':signed(s.todayPnl)}</div><div className="card-foot"><span className={`stat-pill ${tone(s.todayPnl)}`}><ArrowUpRight size={12}/>{hidden?'••••':signedPercent(s.todayPnlPercent)}</span><span>较上一交易日收盘</span></div></section>
    <section className="summary-card"><div className="card-label"><span>持仓标的</span><Layers3 size={17}/></div><div className="summary-value">{s.holdings.length}<small className="value-suffix">只</small></div><div className="card-foot"><span className="small-dot"/>覆盖 <strong>{s.industryWeights.length}</strong> 个行业<span className="foot-end">沪深 A 股</span></div></section>
  </div>
}
