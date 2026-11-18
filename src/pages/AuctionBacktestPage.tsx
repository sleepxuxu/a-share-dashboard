import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useSearchParams } from 'react-router'
import { ArrowLeft, ChartNoAxesCombined, Download, FileCheck2, Info, Play, RefreshCw, Upload } from 'lucide-react'
import { EChart } from '../components/charts/EChart'
import { DEFAULT_AUCTION_RULES, downloadAuctionJson } from '../lib/auction'
import { backtestTemplate, DEFAULT_BACKTEST_SETTINGS, parseBacktestArchive, runAuctionBacktest } from '../lib/auctionBacktest'
import type { AuctionRules } from '../types/auction'
import type { BacktestArchive, BacktestCoverage, BacktestOutcome, BacktestSettings } from '../types/auctionBacktest'
import './auction-backtest.css'

const money = (value: number) => value.toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
const percentage = (value: number | null) => value === null ? '—' : `${value.toFixed(2)}%`
const inputs: [keyof BacktestSettings, string, string, number, number, number][] = [
  ['initialCapital', '初始本金', '元', 1000, 1e10, 10000],
  ['dailyAllocationPercent', '每天新买预算 / 前日总资产', '%', 1, 100, 1],
  ['maxDailyStocks', '每天最多新买', '只', 1, 100, 1],
  ['commissionBps', '佣金（买卖各收）', '万分之', 0, 1000, 0.1],
  ['minimumCommission', '每笔最低佣金', '元', 0, 10000, 1],
  ['stampTaxBps', '印花税（卖出）', '万分之', 0, 1000, 0.1],
  ['transferBps', '过户费（双向）', '万分之', 0, 1000, 0.1],
  ['slippageBps', '单边滑点', '万分之', 0, 1000, 1],
  ['participationPercent', '最多参与首笔成交量', '%', 1, 100, 1],
]

export function AuctionBacktestPage() {
  const [search] = useSearchParams()
  const [rules] = useState<AuctionRules>(() => {
    const volumePercent = Number(search.get('volumePercent')), amountYuan = Number(search.get('amountYuan'))
    return volumePercent > 0 && volumePercent <= 100 && Number.isFinite(amountYuan) && amountYuan > 0 ? { volumePercent, amountYuan } : DEFAULT_AUCTION_RULES
  })
  const [calendar, setCalendar] = useState<BacktestCoverage | null>(null)
  const [loading, setLoading] = useState(true), [error, setError] = useState('')
  const [archive, setArchive] = useState<BacktestArchive | null>(null)
  const [settings, setSettings] = useState(DEFAULT_BACKTEST_SETTINGS)
  const [outcome, setOutcome] = useState<BacktestOutcome | null>(null)
  const [running, setRunning] = useState(false)
  const request = useRef<AbortController | null>(null), file = useRef<HTMLInputElement>(null)
  const loadCoverage = useCallback(async (force = false) => {
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    setLoading(true); setError(''); setOutcome(null)
    try {
      const response = await fetch(`/api/auction/backtest/coverage${force ? '?refresh=1' : ''}`, { signal: controller.signal })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('回测接口未返回 JSON，请检查后端服务。')
      const data = await response.json()
      if (!response.ok) throw new Error(data.error || '交易日历读取失败。')
      if (!Array.isArray(data.sessions) || !data.sessions.length || !Array.isArray(data.missing) || !data.previousTradeDate || !data.startDate || !data.endDate) throw new Error('交易日历格式异常。')
      if (!controller.signal.aborted) setCalendar(data)
    } catch (err) { if (!controller.signal.aborted) setError(err instanceof Error ? err.message : '交易日历读取失败。') }
    finally { if (!controller.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { void loadCoverage(); return () => request.current?.abort() }, [loadCoverage])
  const completeDays = useMemo(() => calendar && archive ? archive.days.filter(day => calendar.sessions.includes(day.date) && day.poolComplete && day.historicalNames).length : 0, [archive, calendar])
  const result = outcome?.status === 'complete' ? outcome : null
  const curveOption = useMemo(() => ({
    animation: false, tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${money(value)} 元` },
    grid: { left: 75, right: 20, top: 20, bottom: 40 }, xAxis: { type: 'category', data: ['期初', ...(result?.curve.map(row => row.date) ?? [])], axisLabel: { color: '#927581' } },
    yAxis: { type: 'value', scale: true, axisLabel: { formatter: (value: number) => value.toLocaleString('zh-CN', { maximumFractionDigits: 0 }), color: '#927581', fontSize: 11 }, splitLine: { lineStyle: { color: '#f0e3e6' } } },
    series: [{ type: 'line', showSymbol: false, data: result ? [result.settings.initialCapital, ...result.curve.map(row => row.equity)] : [], lineStyle: { color: '#ad637e', width: 2 }, areaStyle: { color: '#ad637e12' } }],
  }), [result])
  const drawdownOption = useMemo(() => ({ ...curveOption,
    tooltip: { trigger: 'axis', valueFormatter: (value: number) => `${value.toFixed(2)}%` },
    yAxis: { type: 'value', axisLabel: { formatter: '{value}%', color: '#927581' }, splitLine: { lineStyle: { color: '#f0e3e6' } } },
    series: [{ type: 'line', showSymbol: false, data: [0, ...(result?.curve.map(row => -row.drawdownPercent) ?? [])], lineStyle: { color: '#9189ac', width: 2 }, areaStyle: { color: '#9189ac18' } }],
  }), [result, curveOption])

  async function importFile(selected: File) {
    setOutcome(null); setError(''); setArchive(null)
    try {
      if (selected.size > 25 * 1024 * 1024) throw new Error('历史档案不能超过 25 MB。')
      setArchive(parseBacktestArchive(await selected.text()))
    } catch (err) { setError(err instanceof Error ? err.message : '历史档案读取失败。') }
  }
  function run() {
    if (!archive || !calendar) return
    setError(''); setRunning(true); setOutcome(null)
    // Give the running state a paint before replaying a full archive.
    window.setTimeout(() => {
      try { setOutcome(runAuctionBacktest(archive, calendar, settings, rules)) }
      catch (err) { setError(err instanceof Error ? err.message : '回测失败。') }
      finally { setRunning(false) }
    }, 50)
  }
  return <main className="page backtest-page">
    <Link to="/auction" className="backtest-back"><ArrowLeft size={15} />返回竞价选股</Link>
    <div className="page-heading"><div><div className="eyebrow"><span />AUCTION BACKTEST</div><h1>让竞价信号，接受历史检验<span className="heading-dot">.</span></h1><p>近一年逐日回放，查看扣费盈亏、资金曲线与最大回撤。</p></div><button className="button secondary" disabled={loading || running} onClick={() => void loadCoverage(true)}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? '读取交易日历…' : '重新检查数据'}</button></div>
    {error && <div className="error-banner" role="alert"><Info size={17} />{error}</div>}
    <section className="panel backtest-coverage" aria-label="历史数据覆盖情况">
      <div className="panel-heading"><div className="section-title"><FileCheck2 size={18} /><h2>先核验历史，再计算收益</h2></div><span className="backtest-badge">{result ? '历史档案已回放' : '等待历史竞价档案'}</span></div>
      <div className="backtest-coverage-body"><div><strong>{calendar ? `${calendar.startDate} — ${calendar.endDate}` : loading ? '正在读取近一年交易日历' : '交易日历暂不可用'}</strong><p>{calendar ? `${calendar.sessions.length} 个交易日 · 截至最近已完成交易日，今日未收盘不纳入` : '日历读取成功后，核验每一个交易日的候选池与行情。'}</p><div className="backtest-progress" aria-hidden="true"><span style={{ width: `${calendar ? completeDays / calendar.sessions.length * 100 : 0}%` }} /></div><small>已导入并声明完整候选池及历史名称：{completeDays} / {calendar?.sessions.length ?? '—'} 日（运行时继续核验字段与成交数据）</small></div><div className="backtest-gap"><Info size={19} /><div><strong>当前自动源缺少一年历史竞价快照</strong><p>{calendar?.explanation ?? '需有 09:15:00、09:24:57、09:25:00 的历史报价。日线与最终竞价成交无法还原全部条件。'}</p></div></div></div>
      <div className="backtest-requirements">{(calendar?.missing ?? ['精确时点的历史竞价报价', '完整历史候选池与当时 ST 状态', '连续交易分笔、收盘价与涨跌停限制']).map(item => <span key={item}>{item}</span>)}</div>
    </section>
    <section className="panel backtest-settings" aria-label="回测参数">
      <div className="panel-heading"><div className="section-title"><ChartNoAxesCombined size={18} /><h2>交易规则与资金管理</h2></div><span>参数可调整</span></div>
      <div className="backtest-policy"><strong>09:30 后首个可成交价买入 → 次一交易日收盘卖出</strong><p>复用竞价选股的全部条件：量占比 &gt; {rules.volumePercent}% 或成交额 &gt; {rules.amountYuan / 1e8} 亿元；排除创业板、ST 及负竞价涨幅。</p><p>多只入选按代码升序选前 N 只，预算等额分配。早盘只使用当时现金，下午卖出所得留到下一交易日。</p></div>
      <div className="backtest-inputs">{inputs.map(([key, label, unit, min, max, step]) => <label key={key}>{label}<span><input aria-label={label} type="number" min={min} max={max} step={step} value={Number.isNaN(settings[key]) ? '' : settings[key]} disabled={running} onChange={event => { setSettings({ ...settings, [key]: event.target.value === '' ? NaN : Number(event.target.value) }); setOutcome(null) }} /><small>{unit}</small></span></label>)}</div>
      <details className="backtest-assumptions"><summary>查看成交、费用与风险口径</summary><p>价格使用当日未复权行情，股数按整百股买入（科创板至少 200 股）。按首笔成交量参与上限限制模拟成交；首笔涨停或加滑点后超过涨停价，保守跳过该股票。历史成交分笔只能提供模拟依据，无法保证真实订单成交。</p><p>佣金设每笔最低值，买卖双向收过户费，仅卖出收印花税。默认佣金万 2.5、最低 5 元、印花税万 5、过户费万 0.1、单边滑点万 10；均可调整，单位“万分之”中的 10 = 0.1%。费用按每次成交计算并舍入到分。</p><p>次日停牌或收盘跌停时不假设卖出，逐日延后尝试；期末仍持有按最后收盘估值，浮盈亏单列，不强制清仓。当前不处理除权、分红及送转，相关持仓遇到该事件会阻止报告，避免错算。</p><p>最大回撤以每日收盘总资产相对历史最高值计算，含初始本金；不含盘中回撤。胜率仅统计已平仓交易。候选池须包含当时股票与当时名称，不能用今天的股票列表代替历史范围。</p></details>
    </section>
    <section className="panel backtest-import" aria-label="历史档案导入">
      <div><h2>接入一年的历史档案</h2><p>{archive ? `${archive.demo ? '演示档案（非真实行情） · ' : ''}${archive.days.length} 日 · ${archive.source}` : '自动历史源尚未接通。可导入供应商提供或此前留存的完整档案；空白模板不会生成收益。'}</p>{archive && <small>候选池范围：{archive.scope}</small>}</div>
      <div className="backtest-import-actions"><button className="button secondary" disabled={!calendar || running} onClick={() => calendar && downloadAuctionJson(backtestTemplate(calendar), '竞价回测-历史档案模板.json')}><Download size={16} />下载历史模板</button><button className="button secondary" disabled={running} onClick={() => file.current?.click()}><Upload size={16} />导入历史档案</button><button className="button primary" disabled={!archive || !calendar || loading || running} onClick={run}><Play size={16} />{running ? '正在逐日回放…' : '运行一年回测'}</button><input ref={file} aria-label="历史档案文件" hidden type="file" accept=".json,application/json" onChange={event => { const selected = event.target.files?.[0]; if (selected) void importFile(selected); event.target.value = '' }} /></div>
      <details className="backtest-schema"><summary>历史文件需要哪些字段？</summary><p>days 中每一天填写 date、previousTradeDate、poolComplete（候选池完整）、historicalNames（使用当时名称）、candidates（完整竞价候选，字段同竞价快照）、bars（入选股及持仓逐日行情）。确认没有候选的交易日可保留空数组；缺数据的交易日不能标为完整。</p><p>bars 每行包含 code、close、limitUp、limitDown（均为当日未复权元价格）、suspended、corporateAction，以及 firstTrade：time（北京时间 HH:mm:ss）、price、volume（股）；停牌时 firstTrade 可为 null。遇到除权分红须如实标记 corporateAction，不能直接套前复权价格。首笔为 09:30 后连续交易阶段首个可成交分笔，不是 09:25 竞价成交。</p></details>
    </section>
    {outcome?.status === 'blocked' && <section className="backtest-blocked" role="alert"><strong>数据不完整，未生成年度收益</strong><p>竞价候选覆盖 {outcome.coveredDays} / {outcome.requiredDays} 日；发现 {outcome.gaps.length} 项数据缺口。</p><ul>{outcome.gaps.slice(0, 8).map(gap => <li key={gap}>{gap}</li>)}</ul>{outcome.gaps.length > 8 && <p>另有 {outcome.gaps.length - 8} 项，可导出核验清单查看。</p>}<button className="text-button" onClick={() => downloadAuctionJson(outcome, '竞价回测-缺口清单.json')}>导出全部缺口</button></section>}
    <div className="backtest-result-heading"><div><h2>回测结果</h2><p>{result ? `${archive?.demo ? '演示数据 · ' : ''}含费用与滑点 · 总盈亏 = 已实现 + 持仓浮动` : '历史数据完整并通过核验后，才会生成结果。'}</p></div><button className="button secondary" disabled={!result} onClick={() => result && downloadAuctionJson({ ...result, source: archive?.source, scope: archive?.scope, demo: archive?.demo, period: { start: calendar?.startDate, end: calendar?.endDate }, assumptions: '09:30后首笔可成交价买入，次日收盘卖出；涨停跳过，跌停停牌延后；期末持仓收盘估值；每日收盘最大回撤' }, `${archive?.demo ? '演示-' : ''}竞价回测报告.json`)}><Download size={16} />导出报告</button></div>
    <div className="backtest-metrics" aria-label="回测统计">{[
      ['总盈亏', result ? `${money(result.totalPnl)} 元` : '—'], ['总收益率', result ? percentage(result.returnPercent) : '—'], ['最大回撤', result ? percentage(result.maxDrawdownPercent) : '—'], ['已平仓胜率', result ? percentage(result.winRate) : '—'],
      ['已实现盈亏', result ? `${money(result.closedPnl)} 元` : '—'], ['持仓浮盈亏', result ? `${money(result.openPnl)} 元` : '—'], ['成交费用合计', result ? `${money(result.totalFees)} 元` : '—'], ['交易 / 未平仓', result ? `${result.trades.length} / ${result.trades.filter(row => row.status === 'open').length}` : '—'],
    ].map(([label, value]) => <article className="panel" key={label}><span>{label}</span><strong>{value}</strong></article>)}</div>
    {result ? <>
      <section className="panel backtest-chart"><div className="panel-heading"><h2>收盘总资产曲线</h2><span>元 · 含现金与持仓</span></div><EChart option={curveOption} height={290} label="回测每日收盘总资产曲线" /></section>
      <section className="panel backtest-chart"><div className="panel-heading"><h2>收盘回撤曲线</h2><span>相对历史最高总资产</span></div><EChart option={drawdownOption} height={210} label="回测每日收盘回撤曲线" /></section>
      <section className="panel backtest-trades"><div className="panel-heading"><h2>逐笔盈亏</h2><span>{result.signals} 次入选 · {result.skipped.length} 次未买入 · 展示最近 100 笔，导出含全部</span></div><div className="backtest-table-scroll"><table><thead><tr>{['股票', '买入日 / 时间', '买入价', '股数', '卖出日', '卖出价 / 估值', '净盈亏', '收益率'].map(text => <th key={text}>{text}</th>)}</tr></thead><tbody>{result.trades.slice(-100).reverse().map(trade => <tr key={`${trade.code}-${trade.buyDate}`}><td><strong>{trade.name}</strong><small>{trade.code}</small></td><td>{trade.buyDate}<small>{trade.buyTime}</small></td><td>{trade.buyPrice.toFixed(2)}</td><td>{trade.quantity}</td><td>{trade.sellDate ?? '期末未平仓'}</td><td>{(trade.sellPrice ?? trade.markPrice).toFixed(2)}{trade.status === 'open' && <small>收盘估值</small>}</td><td>{money(trade.pnl)}</td><td>{percentage(trade.returnPercent)}</td></tr>)}</tbody></table>{!result.trades.length && <p className="backtest-no-trades">该档案期间没有可成交交易，资金保持现金。</p>}</div>{result.skipped.length > 0 && <details className="backtest-assumptions"><summary>查看未买入原因（完整明细见报告）</summary>{result.skipped.slice(0, 20).map((row, index) => <p key={index}>{row.date} · {row.code} · {row.reason}</p>)}</details>}</section>
    </> : <div className="panel backtest-empty"><ChartNoAxesCombined size={32} /><h3>等待可核验的历史数据</h3><p>缺少一天的关键数据，也不能将它当成零交易或零收益。</p></div>}
  </main>
}
