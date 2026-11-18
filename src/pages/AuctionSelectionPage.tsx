import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useLocation, useSearchParams } from 'react-router'
import { ArrowLeft, Download, History, Info, RefreshCw, Upload } from 'lucide-react'
import { DEFAULT_AUCTION_RULES, downloadAuctionJson } from '../lib/auction'
import { canSaveAutomaticSelection, makeSelectionDay, parseSelections, readSelections, saveSelections, selectionKey, selectionPricePnl, selectionFloatingPnl, selectionTemplate } from '../lib/auctionSelections'
import type { SelectionArchive, SelectionDay, SelectionPerformance } from '../lib/auctionSelections'
import type { BacktestCoverage } from '../types/auctionBacktest'
import './auction-backtest.css'

const number = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const keyFor = (date: string, code: string) => `${date}|${code}`
const statuses = { complete: '已取得次日收盘', waiting_entry: '等待 09:30', waiting_exit: '等待次日收盘', missing: '行情待补齐' }

export function AuctionSelectionPage() {
  const [query] = useSearchParams(), location = useLocation()
  const rules = useMemo(() => {
    const volumePercent = Number(query.get('volumePercent')), amountYuan = Number(query.get('amountYuan'))
    return Number.isFinite(volumePercent) && volumePercent > 0 && volumePercent <= 100 && Number.isFinite(amountYuan) && amountYuan > 0 ? { volumePercent, amountYuan } : DEFAULT_AUCTION_RULES
  }, [query])
  const [archive, setArchive] = useState<SelectionArchive>({ schemaVersion: 1, kind: 'auction-selections', days: [] })
  const [calendar, setCalendar] = useState<BacktestCoverage | null>(null)
  const [error, setError] = useState(''), [notice, setNotice] = useState('正在读取入选名单…')
  const [performances, setPerformances] = useState<Record<string, SelectionPerformance>>({})
  const [loading, setLoading] = useState(false), [loaded, setLoaded] = useState(0), [rowLimit, setRowLimit] = useState(100)
  const [ready, setReady] = useState(false)
  const file = useRef<HTMLInputElement>(null), controller = useRef<AbortController | null>(null)
  const days = useMemo(() => archive.days.filter(day => day.rules.volumePercent === rules.volumePercent && day.rules.amountYuan === rules.amountYuan), [archive, rules])
  const jobs = useMemo(() => [...days].reverse().flatMap(day => day.stocks.map(stock => ({ day, stock }))), [days])
  const checked = jobs.map(job => ({ ...job, performance: performances[keyFor(job.day.tradeDate, job.stock.code)] }))
  const completed = checked.flatMap(row => {
    const pnl = row.performance && selectionPricePnl(row.performance)
    const buyBlocked = row.stock.limitUpPrice !== null && row.performance?.entry && row.performance.entry.price >= row.stock.limitUpPrice
    return pnl && !buyBlocked ? [pnl] : []
  })
  const yearCovered = calendar ? days.filter(day => day.complete && calendar.sessions.includes(day.tradeDate)).length : 0

  useEffect(() => {
    const abort = new AbortController()
    void (async () => {
      try {
        const incoming = (location.state as { selection?: SelectionDay } | null)?.selection
        let local = readSelections()
        if (incoming) { local = saveSelections(parseSelections(JSON.stringify({ schemaVersion: 1, kind: 'auction-selections', days: [incoming] })).days) }
        if (abort.signal.aborted) return
        setArchive(local); setReady(true); setNotice(incoming ? '已带入并保存本次入选名单，自动读取后续行情。' : '已读取本地历史名单，正在同步最新竞价入选结果。')
        if (!incoming) {
          const response = await fetch('/api/auction', { signal: abort.signal })
          if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('竞价接口未返回 JSON。')
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || '最新入选名单暂不可用。')
          if (!canSaveAutomaticSelection(data)) { setNotice('最终竞价尚未形成或快照过期，暂未保存新名单；已有历史名单可继续查看。'); return }
          local = saveSelections([makeSelectionDay(data, rules)])
          if (!abort.signal.aborted) { setArchive(local); setNotice('已保存最新竞价入选结果，自动读取买入与次日收盘行情。') }
        }
      } catch (err) { if (!abort.signal.aborted) { setError(err instanceof Error ? err.message : '名单读取失败'); setReady(true); setNotice('保留已读取的入选名单。') } }
    })()
    void (async () => {
      try {
        const response = await fetch('/api/auction/backtest/coverage', { signal: abort.signal })
        if (!response.ok) return
        const data = await response.json()
        if (!abort.signal.aborted && Array.isArray(data.sessions)) setCalendar(data)
      } catch { /* Saved samples remain usable without the annual coverage check. */ }
    })()
    return () => abort.abort()
  }, [location.key, location.state, rules])

  const fetchPrices = useCallback(async (force = false) => {
    controller.current?.abort()
    const abort = new AbortController(); controller.current = abort
    setLoading(true); setLoaded(0); setPerformances({})
    let cursor = 0, done = 0
    const batch = jobs.slice(0, 2000)
    async function worker() {
      while (!abort.signal.aborted) {
        const job = batch[cursor++]
        if (!job) break
        const key = keyFor(job.day.tradeDate, job.stock.code)
        try {
          const params = new URLSearchParams({ code: job.stock.code, date: job.day.tradeDate, ...(force ? { refresh: '1' } : {}) })
          const response = await fetch(`/api/auction/performance?${params}`, { signal: abort.signal })
          if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('行情接口未返回 JSON。')
          const data = await response.json()
          if (!response.ok) throw new Error(data.error || '后续行情暂不可用。')
          if (data.code !== job.stock.code || data.tradeDate !== job.day.tradeDate || !['complete', 'waiting_entry', 'waiting_exit', 'missing'].includes(data.status)) throw new Error('后续行情格式不匹配。')
          if (!abort.signal.aborted) setPerformances(old => ({ ...old, [key]: data }))
        } catch (err) {
          if (!abort.signal.aborted) setPerformances(old => ({ ...old, [key]: { code: job.stock.code, tradeDate: job.day.tradeDate, status: 'missing', entry: null, exit: null, nextTradeDate: null, latest: null, warnings: [err instanceof Error ? err.message : '行情读取失败'], source: '', fetchedAt: '' } }))
        }
        if (!abort.signal.aborted) setLoaded(++done)
      }
    }
    await Promise.all([worker(), worker(), worker()])
    if (!abort.signal.aborted) setLoading(false)
  }, [jobs])
  useEffect(() => { if (ready) void fetchPrices(); return () => controller.current?.abort() }, [fetchPrices, ready])

  async function importFile(selected: File) {
    setError('')
    try {
      if (selected.size > 5 * 1024 * 1024) throw new Error('入选名单不能超过 5 MB。')
      const imported = parseSelections(await selected.text())
      const saved = saveSelections(imported.days); setArchive(saved); setRowLimit(100)
      const other = imported.days.filter(day => day.rules.volumePercent !== rules.volumePercent || day.rules.amountYuan !== rules.amountYuan).length
      setNotice(`已导入 ${imported.days.length} 个入选日。${other ? `其中 ${other} 日阈值与当前策略不同，已单独保留，不混入本次统计。` : '开始自动补齐后续行情。'}`)
    } catch (err) { setError(err instanceof Error ? err.message : '导入失败。') }
  }
  return <main className="page backtest-page selection-page">
    <Link to="/auction" className="backtest-back"><ArrowLeft size={15} />返回竞价选股</Link>
    <div className="page-heading"><div><div className="eyebrow"><span />AFTER SELECTION</div><h1>入选之后，看看实际表现<span className="heading-dot">.</span></h1><p>直接使用竞价入选名单，自动补齐 09:30 后首笔成交价与次日收盘价。</p></div><button className="button primary" disabled={loading || !jobs.length} onClick={() => void fetchPrices(true)}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? `取数 ${loaded}/${Math.min(jobs.length, 2000)}` : '刷新后续行情'}</button></div>
    {error && <div className="error-banner" role="alert"><Info size={17} />{error}</div>}
    <section className="panel selection-summary"><div className="panel-heading"><div className="section-title"><History size={18} /><h2>已保存的竞价入选名单</h2></div><span>当前浏览器本地保存</span></div><div className="backtest-policy"><strong>{notice}</strong><p>当前阈值：竞价量占昨量 &gt; {rules.volumePercent}% 或竞价额 &gt; {rules.amountYuan / 1e8} 亿元；只跟踪已经选中的股票，不重复要求竞价报价。</p><p>已记录 {days.length} 个入选日、{jobs.length} 次入选；{calendar ? `一年历史完整名单覆盖 ${yearCovered} / ${calendar.sessions.length} 日（${calendar.startDate} 至 ${calendar.endDate}）。` : '年度名单覆盖待日历核验。'} 未保存的日期不会被当成没有选中股票。</p><p>网页打开并完成竞价取数后才会保存当日结果；关闭网页不会在后台自动采集。相同日期和阈值的最新名单覆盖旧版本，演示名单不保存。</p></div><div className="selection-actions"><button className="button secondary" onClick={() => downloadAuctionJson(selectionTemplate(), '竞价历史入选名单模板.json')}><Download size={15} />名单模板</button><button className="button secondary" onClick={() => file.current?.click()}><Upload size={15} />导入历史入选名单</button><button className="button secondary" disabled={!archive.days.length} onClick={() => downloadAuctionJson(archive, '竞价历史入选名单.json')}><Download size={15} />备份名单</button><input ref={file} type="file" hidden accept=".json,application/json" aria-label="历史入选名单文件" onChange={event => { const selected = event.target.files?.[0]; if (selected) void importFile(selected); event.target.value = '' }} /></div></section>
    <div className="backtest-metrics" aria-label="入选后表现统计"><article className="panel"><span>已取得买入参考价</span><strong>{checked.filter(row => row.performance?.entry).length} 笔</strong></article><article className="panel"><span>已完成价格测算</span><strong>{completed.length} 笔</strong></article><article className="panel"><span>已完成样本每 100 股合计盈亏</span><strong>{completed.length ? `${number(completed.reduce((sum, row) => sum + row.pnl, 0))} 元` : '—'}</strong></article><article className="panel"><span>年度组合盈亏 / 最大回撤</span><strong>待完整记录</strong></article></div>
    <section className="panel backtest-trades"><div className="panel-heading"><h2>入选后价格与盈亏</h2><span>{loading ? '自动读取中' : '买卖时点价格测算'} · 最近 {Math.min(rowLimit, jobs.length)} 条</span></div>{jobs.length ? <><div className="backtest-table-scroll"><table><thead><tr>{['入选日 / 股票', '09:30 后首笔', '次日收盘卖价', '最新价 / 收盘价', '每 100 股净盈亏', '单笔净收益率', '状态 / 数据说明'].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{checked.slice(0, rowLimit).map(({ day, stock, performance }) => {
      const pnl = performance && selectionPricePnl(performance)
      const floating = performance && selectionFloatingPnl(performance)
      const buyBlocked = stock.limitUpPrice !== null && performance?.entry && performance.entry.price >= stock.limitUpPrice
      return <tr key={`${selectionKey(day)}|${stock.code}`}><td><strong>{stock.name}</strong><small>{stock.code} · {day.tradeDate}</small></td><td>{performance?.entry ? <>{number(performance.entry.price)}<small>{performance.entry.time}</small></> : '—'}</td><td>{performance?.exit ? <>{number(performance.exit.price)}<small>{performance.exit.date}</small></> : '—'}</td><td>{performance?.latest ? <>{number(performance.latest.price)}<small>{performance.latest.date} · {performance.latest.final ? '收盘' : '盘中'}</small></> : '—'}</td><td>{!buyBlocked && (pnl || floating) ? <>{number((pnl || floating)!.pnl)}{!pnl && <small>浮盈亏，未计卖出费用</small>}</> : '—'}</td><td>{!buyBlocked && (pnl || floating) ? `${(pnl || floating)!.returnPercent.toFixed(2)}%` : '—'}</td><td className="selection-status">{buyBlocked ? '首笔涨停，按未买入处理' : performance ? statuses[performance.status] : loading ? '正在取数' : '待取数'}{performance?.warnings.map(warning => <small key={warning}>{warning}</small>)}{!day.complete && <small>该日名单不完整，仅统计已知入选股票</small>}</td></tr>
    })}</tbody></table></div>{jobs.length > rowLimit && <div className="selection-actions"><button className="button secondary" onClick={() => setRowLimit(rowLimit + 100)}>再显示 100 条</button></div>}</> : <div className="backtest-empty"><History size={30} /><h3>{ready ? '还没有保存的入选股票' : '正在读取竞价结果'}</h3><p>从竞价选股页面完成筛选，或导入过去的入选名单，即可自动获取后续行情。</p></div>}</section>
    {jobs.length > 2000 && <p className="selection-note" role="alert">本次最多读取最近 2000 条，请将更早记录分批导入；尚未读取的记录不纳入统计。</p>}
    <div className="selection-actions"><button className="button secondary" disabled={!Object.keys(performances).length} onClick={() => downloadAuctionJson({ kind: 'auction-selection-performance', rules, selections: days, prices: performances, benchmark: '每次入选以100股独立测算：09:30后首笔买、次日收盘卖；默认佣金万2.5最低5元、过户费万0.1、卖出印花税万5、单边滑点万10；不是组合资金收益，成交限制和权益事件未完整核验', annualSelectionCoverage: { recorded: yearCovered, required: calendar?.sessions.length ?? null } }, '竞价入选后价格与盈亏.json')}><Download size={15} />导出后续表现</button></div>
    <details className="panel backtest-assumptions"><summary>盈亏口径与历史名单格式</summary><p>按你确认的「09:30 后首笔成交价买入、次一交易日收盘卖出」取得行情。每 100 股独立测算含佣金万 2.5（每笔最低 5 元）、双向过户费万 0.1、卖出印花税万 5、单边滑点万 10。这个样本盈亏合计不是复利收益或全年组合盈亏；年度组合结果需要逐日完整入选记录、仓位和成交限制。</p><p>今日尚未到次日收盘时显示买入参考价、最新行情及浮盈亏（含买入费，未计未来卖出费），不生成卖出价或已实现收益。分笔缺失不拿 09:25 竞价成交或日线开盘价替代；次日停牌或缺日线不拿下一根日线冒充次日。次日跌停可成交性、成交量参与约束及除权分红未完整核验，净盈亏仅为买卖时点价格测算。</p><p>历史名单只需 days 数组；每项提供 tradeDate、source、rules、complete 和 stocks（code、name，可附 limitUpPrice），不需 09:15 或 09:24:57 的历史报价。complete 表示当日最终名单完整，未知不能写 true；完整零入选日用空 stocks 数组。也支持竞价页的「导出入选」文件。</p><Link to="/auction/strategy-backtest" className="backtest-back">查看完整交易档案的组合回放</Link></details>
  </main>
}
