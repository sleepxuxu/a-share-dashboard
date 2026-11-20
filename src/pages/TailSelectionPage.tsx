import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { ArrowDown, ArrowUpRight, BookOpen, Check, ChevronRight, CircleHelp, ClipboardCheck, Clock3, Download, ExternalLink, Info, ListFilter, RefreshCw, Search, ShieldCheck, Sparkles, Star, Sunset, X } from 'lucide-react'
import { Modal } from '../components/layout/Modal'
import { FundamentalsPanel } from '../components/research/FundamentalsPanel'
import { SkillResearchPanel } from '../components/research/SkillResearchPanel'
import { useWatchlistStore } from '../stores/watchlistStore'
import { useRefreshInterval } from '../hooks/useRefreshInterval'
import { makeTailDemo, reviewComplete, tailBoard, tailPhase, tailReviews } from '../lib/tailSelection'
import type { ReviewValue, Trend } from '../lib/tailSelection'
import type { TailSnapshot, TailStock } from '../types/tailSelection'
import './tail-selection.css'

const fmt = (value: number | null, digits = 2) => value === null ? '—' : value.toLocaleString('zh-CN', { minimumFractionDigits: digits, maximumFractionDigits: digits })
const time = (value: string) => new Date(value).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })
const gateLabels = ['涨幅 3%–5%', '量比 ≥ 1', '换手 5%–10%', '流通市值 50–200 亿']
const emptyReview = (): ReviewValue[] => tailReviews.map(() => 'pending')

export function TailSelectionPage() {
  const [data, setData] = useState<TailSnapshot | null>(null), [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [market, setMarket] = useState<'main' | 'all'>('main')
  const [auto, setAuto] = useState(false), [clock, setClock] = useState(Date.now())
  const [filter, setFilter] = useState('matched'), [search, setSearch] = useState(''), [selectedCode, setSelectedCode] = useState('')
  const [trend, setTrend] = useState<Trend>('pending'), [reviews, setReviews] = useState<Record<string, ReviewValue[]>>({})
  const [research, setResearch] = useState<TailStock | null>(null), [rulesOpen, setRulesOpen] = useState(false)
  const request = useRef<AbortController | null>(null), reviewPanel = useRef<HTMLElement | null>(null)
  const watched = useWatchlistStore(state => state.stocks), toggle = useWatchlistStore(state => state.toggle)
  const load = useCallback(async (force = false) => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError('')
    try {
      const params = new URLSearchParams({ market, ...(force ? { refresh: '1' } : {}) })
      const response = await fetch(`/api/tail-selection?${params}`, { signal: controller.signal })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('选股接口未返回 JSON，请检查部署中的后端 API。')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '尾盘行情暂不可用')
      if (result.market !== market) throw new Error('接口返回的市场范围不一致，请刷新页面或检查后端版本。')
      if (!controller.signal.aborted) { setData(result); setReviews({}); setTrend('pending') }
    } catch (err) {
      if (!controller.signal.aborted) { setError(err instanceof Error ? err.message : '行情读取失败'); setData(old => old ? { ...old, stale: true } : null) }
    } finally { if (!controller.signal.aborted) setLoading(false) }
  }, [market])
  useEffect(() => {
    void load()
    const timer = window.setInterval(() => setClock(Date.now()), 15000)
    return () => { request.current?.abort(); window.clearInterval(timer) }
  }, [load])
  useRefreshInterval(() => void load(), auto && !data?.demo, 60000)
  const phase = tailPhase(clock)
  const matched = useMemo(() => data?.candidates.filter(stock => stock.gates.every(gate => gate === true)) || [], [data])
  const rows = useMemo(() => (data?.candidates || []).filter(stock =>
    (filter !== 'matched' || stock.gates.every(gate => gate === true)) &&
    (filter !== 'watched' || watched.some(item => item.code === stock.code)) &&
    `${stock.name} ${stock.code} ${stock.industry}`.toLowerCase().includes(search.trim().toLowerCase())), [data, filter, watched, search])
  const selected = rows.find(stock => stock.code === selectedCode) || rows[0]
  const values = selected ? reviews[selected.code] || emptyReview() : emptyReview()
  const hasFailure = values.includes('fail'), completed = reviewComplete(values)
  const marketConfirmed = !['pending', 'falling'].includes(trend)
  const current = !!data && !data.demo && data.isToday && !data.stale && !error && clock - Date.parse(data.asOf) <= 300000 && Date.parse(data.asOf) <= clock + 60000
  const stateTitle = hasFailure ? '存在未通过项' : !selected?.gates.every(Boolean) ? '数值条件未全部满足' : completed ? '人工复核已完成' : '等待补齐复核证据'
  function demo() {
    request.current?.abort(); setLoading(false); setAuto(false); setError(''); setReviews({}); setTrend('pending'); setSelectedCode(''); setData(makeTailDemo(market))
  }
  function exportResult() {
    if (!data) return
    const payload = { kind: 'tail-selection-observation', schemaVersion: 1, demo: data.demo, exportedAt: new Date().toISOString(), snapshot: data, manualReview: { snapshotAsOf: data.asOf, trend, stocks: reviews }, note: '数值初筛与人工观察记录，不代表完整策略通过或成交指令。' }
    const url = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }))
    const a = document.createElement('a'); a.href = url; a.download = `${data.demo ? '演示-' : ''}尾盘观察-${data.marketDate}.json`; a.click(); URL.revokeObjectURL(url)
  }
  function pick(stock: TailStock) { setSelectedCode(stock.code); reviewPanel.current?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }) }

  return <main className="page tail-page">
    <div className="page-heading"><div><div className="eyebrow"><span />THE CLOSING BELL</div><h1>把筛选，留给尾盘<span className="heading-dot">.</span></h1><p>杨永兴十步尾盘法 · 先过条件，再看证据，最后守纪律。</p></div><div className="tail-top-actions"><button className="button secondary" onClick={() => setRulesOpen(true)}><BookOpen size={16} />策略说明</button><button className="button primary" disabled={loading} onClick={() => void load(true)}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? '正在扫描…' : '刷新筛选'}</button></div></div>

    <section className="tail-hero" aria-label="尾盘策略时间轴"><div className="tail-hero-copy"><span className="tail-kicker"><Sunset size={17} />尾盘有序，次日有期</span><h2>不急着出手。<br />等条件，一项项成立。</h2><p>14:30 开始筛选，14:50–14:58 复核介入条件。<br />次日 10:00 前退出，是这套方法的纪律。</p><div className="tail-clock"><i /><span>{phase.title}</span><small>{new Date(clock).toLocaleTimeString('zh-CN', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', hour12: false })} 北京时间</small></div></div>
      <div className="tail-timeline">{[
        ['14:30', '开始筛选', '涨幅 · 量比 · 换手 · 市值'], ['14:50–14:58', '尾盘复核', '量价 · 分时 · 触发信号'], ['次日 10:00 前', '按纪律退出', '盈亏都应遵守退出规则'],
      ].map(([label, title, detail], index) => <div className={`tail-time-step ${phase.stage === index + 1 ? 'active' : ''}`} key={label}><span className="tail-time-node">{index + 1}</span><div><strong>{label}</strong><b>{title}</b><p>{detail}</p></div>{index < 2 && <ArrowDown size={14} />}</div>)}<span className="tail-timeline-note">{phase.detail}</span></div>
    </section>

    {data?.demo && <div className="tail-demo-banner" role="status"><Sparkles size={17} /><span><strong>演示模式</strong> · 虚构样本，仅体验筛选与复核流程</span><button onClick={() => void load(true)}>返回真实行情 <ArrowUpRight size={14} /></button></div>}
    {error && <div className="error-banner" role="alert"><Info size={17} /><span>{error}{data ? '；下方保留旧快照。' : '，可稍后重试，或体验演示流程。'}</span><button className="text-button" onClick={demo}>体验演示</button></div>}
    <div className="tail-data-bar"><div><span className={`tail-status-dot ${current ? 'fresh' : ''}`} />{data ? data.demo ? '虚构演示' : current ? '当日行情快照' : '快照 / 待更新' : loading ? '正在读取行情' : '行情暂未取得'}<span className="tail-bar-divider" /> <Clock3 size={13} />{data ? `${time(data.asOf)}（北京时间）` : '等待行情时间戳'}</div><label><input type="checkbox" checked={auto} disabled={data?.demo} onChange={event => setAuto(event.target.checked)} />60 秒自动更新</label></div>
    {data?.warnings.map(warning => <p className="tail-warning" key={warning}><Info size={14} />{warning}</p>)}
    <section className="panel tail-market-scope" aria-label="市场范围设置"><div><ListFilter size={17} /><div><strong>选股范围：{market === 'main' ? '沪深主板' : '全部沪深 A 股'}</strong><p>{market === 'main' ? '排除创业板（300 / 301 等）与科创板；默认不混入不同交易板块。' : '包含主板、创业板、科创板；各板块涨跌幅限制不同，卡片单独标识。'}</p></div></div><select aria-label="选股市场范围" value={market} onChange={event => { request.current?.abort(); setData(null); setLoading(true); setError(''); setReviews({}); setTrend('pending'); setSelectedCode(''); setMarket(event.target.value as 'main' | 'all') }}><option value="main">沪深主板（默认）</option><option value="all">全部沪深 A 股</option></select></section>

    <div className="tail-overview"><section className="panel tail-index-panel"><div className="tail-mini-heading"><ActivityIcon /><h2>先看大盘</h2><span>单日涨跌不代表趋势</span></div><div className="tail-index-list">{(data?.indices.length ? data.indices : [{ code: '000001', name: '上证指数', price: null, change: null, asOf: null }, { code: '399001', name: '深证成指', price: null, change: null, asOf: null }, { code: '399006', name: '创业板指', price: null, change: null, asOf: null }]).map(index => <article key={index.code}><span>{index.name}</span><strong className={index.change === null ? '' : index.change >= 0 ? 'up' : 'down'}>{fmt(index.price)}</strong><small className={index.change === null ? '' : index.change >= 0 ? 'up' : 'down'}>{index.change === null ? '暂无数据' : `${index.change >= 0 ? '+' : ''}${fmt(index.change)}%`}</small><span className="tail-index-time">{index.asOf ? time(index.asOf) : '时间待核实'}</span></article>)}</div></section>
      <section className="panel tail-result-stat"><div className="tail-mini-heading"><ClipboardCheck size={17} /><h2>数值初筛</h2><span>步骤 02–05</span></div><div><strong>{data ? matched.length : '—'}<small>只</small></strong><span>同时满足 4 项条件<br /><b>分时、K 线及风险仍待复核</b></span></div><p>已扫描 {data?.scannedCount ?? '—'} 只 · 原始市场记录 {data?.total ?? '—'} 只</p></section></div>

    <div className="tail-workspace"><aside className="tail-sidebar"><section className="panel tail-rule-panel"><div className="tail-mini-heading"><ListFilter size={17} /><h2>筛选路径</h2><span>不放宽条件</span></div><div className="tail-funnel-start"><span>有效行情样本</span><b>{data?.stages[0] ?? '—'}</b></div>{gateLabels.map((label, i) => <div className="tail-funnel-step" key={label}><div><span className="tail-step-number">0{i + 2}</span><div><strong>{label}</strong><small>{['强势启动，避免过热', '有增量成交参与', '活跃且分歧可控', '注意流通与总市值口径'][i]}</small></div><b>{data?.stages[i + 1] ?? '—'}</b></div><div className="tail-funnel-track"><i style={{ width: `${data?.stages[0] ? (data.stages[i + 1] / data.stages[0]) * 100 : 0}%` }} /></div></div>)}<p className="tail-rule-note"><CircleHelp size={14} />只自动检查数值门槛，后续条件逐项确认。缺失字段不视为通过。</p></section>
      <section className="panel tail-discipline"><ShieldCheck size={23} /><h2>把纪律写在前面</h2><p><b>单票 ≤ 20%</b><span>采用文档范围的保守上限</span></p><p><b>单日最多 3 只</b><span>不满仓，不降格凑数</span></p><p><b>单笔亏损触及 2%</b><span>文档止损纪律；无法保证成交</span></p><p><b>回撤超过 2%</b><span>按文档暂停 3 天，重新复盘</span></p><button onClick={() => setRulesOpen(true)}>查看退出规则 <ChevronRight size={14} /></button></section></aside>

      <div className="tail-results"><section className="panel tail-market-gate"><div><span className="tail-step-number">01</span><div><h2>大盘趋势，先确认</h2><p>需要指数历史 K 线佐证，不能用今日涨跌代替趋势。</p></div></div><select aria-label="大盘趋势人工确认" value={trend} onChange={event => setTrend(event.target.value as Trend)}><option value="pending">待核实大盘趋势</option><option value="rebound">已核实 · 短期反弹</option><option value="rising">已核实 · 中期上升</option><option value="strong">已核实 · 长期上升</option><option value="falling">下跌趋势 · 暂停观察</option></select></section>
      {!marketConfirmed && <p className="tail-gate-note"><ShieldCheck size={15} />{trend === 'falling' ? '大盘前提不成立；以下结果仅供复盘，不进入执行环节。' : '大盘前提尚未确认；先展示数值初筛，后续保持待核实。'}</p>}
      <div className="tail-candidate-heading"><div><h2>尾盘观察池 <span>{rows.length}</span></h2><p>数值匹配只是开始，证据完整才值得继续观察。</p></div><button className="button secondary compact" disabled={!data || loading} onClick={exportResult}><Download size={15} />导出快照</button></div>
      <div className="tail-toolbar"><div className="tail-tabs" role="group" aria-label="尾盘候选筛选">{[['matched', '数值通过', matched.length], ['all', '涨幅初筛', data?.candidates.length ?? 0], ['watched', '已观察', data?.candidates.filter(stock => watched.some(item => item.code === stock.code)).length ?? 0]].map(([key, label, count]) => <button key={key} aria-pressed={filter === key} className={filter === key ? 'active' : ''} onClick={() => setFilter(String(key))}>{label}<span>{count}</span></button>)}</div><label className="tail-search"><Search size={15} /><input aria-label="搜索尾盘候选" placeholder="名称 / 代码 / 行业" value={search} onChange={event => setSearch(event.target.value)} />{search && <button aria-label="清空搜索" onClick={() => setSearch('')}><X size={14} /></button>}</label></div>
      {loading && !data ? <div className="panel tail-empty" role="status"><RefreshCw size={28} className="spinning" /><h3>正在读取尾盘候选</h3><p>获取涨幅排行与指数，依次检查四项数值条件。</p></div> : rows.length ? <div className="tail-stock-grid">{rows.map(stock => {
        const observing = !data?.demo && watched.some(item => item.code === stock.code)
        const count = stock.gates.filter(Boolean).length
        return <article className={`panel tail-stock-card ${selected?.code === stock.code ? 'selected' : ''}`} key={stock.code}><div className="tail-stock-top"><div><span className="tail-stock-industry">{stock.industry}</span><h3>{stock.name}</h3><small>{stock.code}<span className="tail-board-label">{tailBoard(stock.code)}</span></small></div><button className={`icon-button ${observing ? 'tail-starred' : ''}`} aria-label={`${observing ? '移出观察' : '加入观察'}${stock.name}`} aria-pressed={observing} disabled={data?.demo} title={data?.demo ? '演示股票不保存到真实观察名单' : ''} onClick={() => toggle(stock)}><Star size={18} fill={observing ? 'currentColor' : 'none'} /></button></div><div className="tail-stock-price"><strong>{fmt(stock.price)}</strong><span className="up">+{fmt(stock.change)}%</span><span className={`tail-pass-badge ${count < 4 ? 'partial' : ''}`}>{count === 4 ? <Check size={12} /> : <Info size={12} />}{count}/4 数值条件</span></div><div className="tail-stock-metrics">{[['量比', stock.volumeRatio, '倍', 1], ['换手率', stock.turnover, '%', 2], ['流通市值', stock.floatCap === null ? null : stock.floatCap / 1e8, '亿', 3]].map(([label, value, unit, gate]) => <div className={stock.gates[Number(gate)] === true ? '' : 'unmet'} key={String(label)}><span>{label}</span><b>{fmt(value as number | null)}<small>{unit}</small></b></div>)}</div><div className="tail-stock-bottom"><span><span className="tail-status-dot" />{reviews[stock.code]?.includes('fail') ? '有未通过复核项' : reviewComplete(reviews[stock.code] || []) ? '人工复核已记录' : '量价与风险待复核'}</span><button onClick={() => pick(stock)}>逐项复核 <ArrowUpRight size={14} /></button></div></article>
      })}</div> : <div className="panel tail-empty"><Search size={29} /><h3>{search || filter === 'watched' ? '没有找到匹配的候选' : data ? '本轮没有数值通过的候选' : '等待一份有效行情'}</h3><p>{filter === 'watched' ? '这里仅显示本轮扫描范围内已观察的股票。' : '保持条件，不为凑数降低门槛。可查看涨幅初筛，了解未通过的项目。'}</p><div><button className="button secondary" onClick={() => { setSearch(''); setFilter('all') }}>查看涨幅初筛</button><button className="text-button" onClick={demo}>体验演示</button></div></div>}

      {selected && <section ref={reviewPanel} className="panel tail-review" aria-label="个股逐项复核"><div className="tail-review-heading"><div><span className="tail-kicker"><ClipboardCheck size={15} />EVIDENCE CHECK</span><h2>{selected.name}<small>{selected.code}</small></h2><p>复核记录只对应这份快照，刷新行情后重新确认。</p></div><button className="button secondary compact" disabled={data?.demo} onClick={() => setResearch(selected)}><BookOpen size={15} />Skill 研究 <ArrowUpRight size={14} /></button></div><div className="tail-review-items">{tailReviews.map((item, i) => <div className="tail-review-item" key={item.title}><span className="tail-step-number">{item.step}</span><div><h3>{item.title}</h3><p>{item.detail}</p></div><select aria-label={item.title} value={values[i]} onChange={event => { const updated = [...values]; updated[i] = event.target.value as ReviewValue; setReviews(old => ({ ...old, [selected.code]: updated })) }}><option value="pending">待核实</option><option value="pass">人工确认通过</option><option value="fail">未通过</option></select></div>)}</div><div className={`tail-review-summary ${hasFailure ? 'failed' : ''}`} role="status"><ShieldCheck size={19} /><div><strong>{stateTitle}</strong><p>{!current ? '当前为演示、历史或延迟数据，仅用于复盘。' : !marketConfirmed ? '大盘前提未成立，保留观察。' : phase.stage !== 2 ? '当前不在 14:50–14:58 窗口内；记录复核，不产生执行信号。' : '按快照记录人工判断；还需现场确认流动性和触发时点。'} 人工勾选不等于系统已验证。</p></div><span>{values.filter(value => value === 'pass').length}/{tailReviews.length}</span></div><div className="tail-optional"><Star size={14} /><span>加分项待查：近 20–30 日涨停记录、当日热点成员关系。量比 2–5 优先，超过 5 需留意异常放量。</span></div></section>}
      </div></div>
    <div className="tail-footnote"><div><Info size={15} /><p>{data?.scope || '按所选市场范围扫描涨幅排行，最多前 1000 条，排除 ST / 退市标记。'} 单次快照无法验证分时均价线、历史均线及突破；此页不自动下单。</p></div>{data?.source.url && <a href={data.source.url} target="_blank" rel="noreferrer">{data.source.name}<ExternalLink size={13} /></a>}<button onClick={demo}>体验演示 <ArrowUpRight size={13} /></button></div>

    {research && <Modal title={`${research.name} · 公司与风险研究`} subtitle="沿用项目的量价、基本面与反向风险 Skill，按需读取证据。" wide onClose={() => setResearch(null)}><SkillResearchPanel code={research.code} /><FundamentalsPanel holdings={[{input:{code:research.code,name:research.name,quantity:0,costPrice:0},quote:null,marketValue:0,pnl:0,pnlPercent:null,weight:0}]} demo={false} selectedCode={research.code} onSelect={() => {}} /></Modal>}
    {rulesOpen && <Modal title="杨永兴十步尾盘法" subtitle="规则参考：项目 yang.md；数据边界参考项目的三份研究 Skill。" onClose={() => setRulesOpen(false)}><div className="tail-rules-dialog"><h3>先过大盘，再过四项数值门槛</h3><p>人工确认大盘上升或阶段反弹；下跌趋势停止。涨幅 3%–5%、量比 ≥1、换手 5%–10%、流通市值 50–200 亿元须同时满足。</p><h3>把证据补齐</h3><p>确认温和放量、K 线上方无明显压力、分时强于大盘且在均价线上方，再核实 14:30 后突破与回踩信号。财务亏损、质押与公告需另查原文，快照不能替代。</p><h3>次日退出规则 · 步骤 10</h3><p>文档约定次日 09:30–10:00 清仓；向上走势破均价线或趋势线退出，走弱时破前低退出。低开超过 2% 按文档在集合竞价退出；缩量涨停或一字涨停是文档列出的例外。价格与时间规则不保证成交。</p><h3>原文存在的口径冲突</h3><p>原文同时写有 14:50–14:58 买入与避开 14:55 后突击拉涨，本页保留完整窗口并提醒排除急拉。大盘仓位段提到长期上升满仓，风控段又规定严禁满仓；本页采用较保守风控：单票上限 20%、最多 3 只、不满仓。</p><h3>不把缺失资料当作通过</h3><p>仅四项数值条件自动筛选，其余为人工复核记录；既不输出胜率，也不因高分推断收益。近 20–30 日涨停与热点关系列为待查加分项；原文在“加分项”和“不碰”中对无涨停个股也有不同描述，未自动认定其通过。</p><p className="muted">依据 .agents/skills 中的 a-share-tape、a-share-fundamentals、a-share-risk-review：区分行情时点、事实与待核实证据。人工记录暂存在页面内存，离开或刷新后清除；可导出快照留档。</p></div></Modal>}
  </main>
}

function ActivityIcon() { return <Sunset size={17} /> }
