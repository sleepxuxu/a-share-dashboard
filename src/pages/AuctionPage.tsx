import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router'
import { ArrowRight, Check, ChevronDown, Clock3, Download, FileJson, Info, ListFilter, Play, RefreshCw, Search, SlidersHorizontal, Target, Upload, X } from 'lucide-react'
import { auctionDemo, auctionOpeningPrices, auctionReferencePrices, auctionTemplate, DEFAULT_AUCTION_RULES, downloadAuctionJson, MIN_AUCTION_AMOUNT, parseAuctionDataset, screenAuction } from '../lib/auction'
import type { AuctionDataset, AuctionResult, AuctionRules } from '../types/auction'
import { Modal } from '../components/layout/Modal'
import { useRefreshInterval } from '../hooks/useRefreshInterval'
import { canSaveAutomaticSelection, makeSelectionDay, saveSelections } from '../lib/auctionSelections'
import { clearAuctionMatches, readAuctionMatches, restoreAuctionMatches, retainAuctionMatches, saveAuctionMatches } from '../lib/auctionRetention'

const chinaToday = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const price = (value: number | null) => value === null ? '—' : value.toFixed(2)
const label = { matched: '符合条件', rejected: '未通过', pending: '待核验' }
const checkLabel = { pass: '通过', fail: '未通过', missing: '缺数据' }
const fields = [
  ['previousClose', '前一交易日收盘价（元）'], ['previousLimitUpPrice', '前一交易日涨停价（元）'],
  ['previousVolume', '前一交易日全天成交量（股）'], ['limitUpPrice', '今日涨停价（元）'],
  ['price091500', '今日 09:15:00 竞价价格（元）'], ['price091501', '今日 09:15:01 竞价价格（元，可省略）'], ['price091502', '今日 09:15:02 竞价价格（元，可省略）'], ['price092457', '今日 09:24:57 竞价价格（元）'],
  ['price092458', '今日 09:24:58 竞价价格（元，可省略）'], ['price092459', '今日 09:24:59 竞价价格（元，可省略）'],
  ['price092500', '今日 09:25:00–09:25:05 内最新竞价价格（元）'], ['auctionTime', '最终竞价实际采样时间（北京时间，旧快照可省略）'], ['auctionVolume', '同一笔最终竞价成交量（股）'],
  ['auctionAmount', '09:25 最终竞价成交额（元）'],
]

export function AuctionPage() {
  const [matchMemory, setMatchMemory] = useState(readAuctionMatches)
  const [snapshot, setDataset] = useState<AuctionDataset | null>(() => restoreAuctionMatches(matchMemory))
  const [retentionError, setRetentionError] = useState('')
  const [automaticMode, setAutomaticMode] = useState(true), [autoRefresh, setAutoRefresh] = useState(true)
  const [loading, setLoading] = useState(true), [fetchError, setFetchError] = useState('')
  const request = useRef<AbortController | null>(null)
  const fetchInProgress = useRef(false)
  const [demo, setDemo] = useState(false), [importing, setImporting] = useState(false)
  const [rules, setRules] = useState<AuctionRules>(() => matchMemory?.rules ?? DEFAULT_AUCTION_RULES)
  const retained = useMemo(() => retainAuctionMatches(snapshot, rules, matchMemory), [snapshot, rules, matchMemory])
  const dataset = retained.dataset
  useEffect(() => {
    if (!retained.memory || retained.memory === matchMemory) return
    setMatchMemory(retained.memory)
    try { saveAuctionMatches(retained.memory); setRetentionError('') }
    catch { setRetentionError('已在本页保留入选记录，但未能保存到浏览器；请导出备份。') }
  }, [retained.memory, matchMemory])
  const [percentInput, setPercentInput] = useState(String(rules.volumePercent)), [amountInput, setAmountInput] = useState(String(rules.amountYuan / 1e8)), [ruleError, setRuleError] = useState('')
  const [filter, setFilter] = useState<'all' | AuctionResult['status']>('matched'), [search, setSearch] = useState('')
  const [selected, setSelected] = useState<AuctionResult | null>(null)
  const results = useMemo(() => dataset?.records.map(record => screenAuction(record, rules)) ?? [], [dataset, rules])
  const counts = { matched: results.filter(row => row.status === 'matched').length, pending: results.filter(row => row.status === 'pending').length, rejected: results.filter(row => row.status === 'rejected').length }
  const rows = results.filter(row => (filter === 'all' || row.status === filter) && `${row.record.name} ${row.record.code}`.toLowerCase().includes(search.trim().toLowerCase()))
  const stages = [...[0, 1, 2, 3].map(index => results.filter(row => row.checks.slice(0, index + 1).every(check => check.status === 'pass')).length), counts.matched]
  const changed = Number(percentInput) !== rules.volumePercent || Number(amountInput) * 1e8 !== rules.amountYuan
  const automatic = dataset?.automatic
  const [saveError, setSaveError] = useState('')
  useEffect(() => {
    if (!dataset || demo || !automaticMode || !canSaveAutomaticSelection(dataset)) return
    try { saveSelections([makeSelectionDay(dataset, rules)]); setSaveError('') }
    catch { setSaveError('入选名单未能保存到浏览器，请导出备份；仍可查看本次选股结果。') }
  }, [dataset, rules, demo, automaticMode, automatic])
  const fetchAutomatic = useCallback(async (force = false, skipInFlight = false) => {
    if ((!force || skipInFlight) && fetchInProgress.current && !request.current?.signal.aborted) return
    request.current?.abort()
    const controller = new AbortController(); request.current = controller
    fetchInProgress.current = true
    setAutomaticMode(true); setLoading(true); setFetchError('')
    try {
      const response = await fetch(`/api/auction${force ? '?refresh=1' : ''}`, { signal: controller.signal })
      if (!response.headers.get('content-type')?.includes('application/json')) throw new Error('竞价接口返回非 JSON 内容，请检查部署是否包含后端 API。')
      const result = await response.json()
      if (!response.ok) throw new Error(result.error || '自动竞价数据暂不可用，请稍后重试。')
      if (!result.automatic || !Array.isArray(result.records)) throw new Error('竞价快照格式异常，请重试。')
      if (!controller.signal.aborted) { setDataset(result); setDemo(false); setSelected(null) }
    } catch (error) { if (!controller.signal.aborted) setFetchError(error instanceof Error ? error.message : '自动取数失败，请重试。') }
    finally { if (request.current === controller) fetchInProgress.current = false; if (!controller.signal.aborted) setLoading(false) }
  }, [])
  useEffect(() => { void fetchAutomatic(); return () => request.current?.abort() }, [fetchAutomatic])
  useRefreshInterval(() => void fetchAutomatic(true, true), automaticMode && autoRefresh, 30000)
  useEffect(() => {
    if (!automaticMode || !autoRefresh) return
    let timer: number
    const schedule = () => {
      const now = Date.now()
      const cutoff = Date.parse(`${chinaToday()}T09:25:05+08:00`)
      timer = window.setTimeout(() => {
        if (document.visibilityState === 'visible') void fetchAutomatic(true)
        schedule()
      }, (cutoff > now ? cutoff : cutoff + 86400000) - now)
    }
    schedule()
    return () => window.clearTimeout(timer)
  }, [automaticMode, autoRefresh, fetchAutomatic])

  function applyRules() {
    const volumePercent = Number(percentInput), amountYuan = Number(amountInput) * 1e8
    if (!percentInput.trim() || !amountInput.trim() || !Number.isFinite(volumePercent) || volumePercent <= 0 || volumePercent > 100 || !Number.isFinite(amountYuan) || amountYuan <= 0 || amountYuan > 1e14) {
      setRuleError('量占比须大于 0 且不超过 100%，成交额须大于 0 且不超过 100 万亿元。'); return
    }
    setRules({ volumePercent, amountYuan }); setRuleError(''); setSelected(null)
  }
  function load(data: AuctionDataset, isDemo: boolean) {
    request.current?.abort(); setAutomaticMode(false); setLoading(false); setFetchError('')
    setDataset(data); setDemo(isDemo || data.demo === true); setFilter('matched'); setSearch(''); setSelected(null)
  }

  return <main className="page auction-page">
    <div className="auction-backtest-entry"><Link className="button secondary" to={`/auction/backtest?volumePercent=${rules.volumePercent}&amountYuan=${rules.amountYuan}`} state={dataset && !demo && (!automatic || canSaveAutomaticSelection(dataset)) ? { selection: makeSelectionDay(dataset, rules) } : undefined}><Play size={15} />回测入选股票<ArrowRight size={15} /></Link></div>
    {saveError && <p className="selection-note" role="alert">{saveError}</p>}
    {retentionError && <p className="selection-note" role="alert">{retentionError}</p>}
    <div className="page-heading"><div><div className="eyebrow"><span />AUCTION SCREENER</div><h1>在开盘前，捕捉竞价信号<span className="heading-dot">.</span></h1><p>自动扫描昨日涨停股票，核验秒级竞价价格与最终成交。</p></div><div className="auction-actions"><button className="button secondary" onClick={() => downloadAuctionJson(auctionTemplate(), '竞价快照模板.json')}><Download size={16} />下载模板</button><button className="button secondary" onClick={() => setImporting(true)}><Upload size={16} />导入竞价快照</button><button className="button primary" disabled={loading} onClick={() => void fetchAutomatic(true)}><RefreshCw size={16} className={loading ? 'spinning' : ''} />{loading ? '正在取数…' : '刷新竞价'}</button></div></div>

    <div className="auction-source"><span className="auction-source-icon"><Clock3 size={20} /></span><div><strong>{demo ? '演示模式 · 虚构数据' : automatic ? '自动竞价快照' : dataset ? '已导入竞价快照' : loading ? '正在读取秒级竞价数据' : '自动竞价数据暂不可用'}</strong><p>{dataset ? `${dataset.tradeDate} 竞价 · 前一交易日 ${dataset.previousTradeDate} · ${dataset.source}` : '从昨日涨停池取得候选，读取 09:15:00／01／02、09:24:57／58／59 精确分笔及 09:25:00–09:25:05 内最新竞价分笔；缺失时点保持待核验。'}</p></div><span className={`auction-source-tag ${demo ? 'demo' : ''}`}>{demo ? '非真实行情' : automatic ? automatic.stale || fetchError ? '快照待更新' : '已自动取数' : dataset ? '导入数据' : '自动取数'}</span></div>
    {fetchError && <div className="error-banner" role="alert"><Info size={17} /><span>{fetchError}{dataset ? ' · 保留当前快照，请留意来源与日期。' : ''}</span><button className="text-button" onClick={() => void fetchAutomatic(true)}>重试</button></div>}
    {automatic && <div className="auction-auto-meta"><span>行情时间 {new Date(automatic.asOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）</span><span>已扫描 {automatic.scannedCount} 只 · {automatic.incompleteCount} 只存在缺失字段</span><label><input type="checkbox" checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />30 秒自动更新{!automaticMode ? '（已暂停）' : ''}</label></div>}
    {automatic?.warnings.slice(3).map(warning => <p className="auction-history" key={warning}><Info size={15} />{warning}</p>)}
    {dataset && dataset.tradeDate !== chinaToday() && <p className="auction-history"><Info size={15} />当前为 {dataset.tradeDate} 的历史快照，筛选结果不代表今日行情。</p>}

    <section className="panel auction-strategy" aria-labelledby="auction-strategy-title">
      <div className="panel-heading"><div className="section-title"><SlidersHorizontal size={18} /><h2 id="auction-strategy-title">竞价筛选条件</h2></div><span className="auction-logic">四项竞价规则 + 三项附加条件</span></div>
      <div className="auction-rules">
        <article><span className="auction-step">01 <span>前一交易日</span></span><h3>昨日收盘涨停</h3><p>收盘价 = 昨日涨停价</p><small>按实际涨停价判断，覆盖不同涨幅限制。</small><span className="auction-rule-symbol"><Check size={15} />收盘封板</span></article>
        <article><span className="auction-step">02 <span>09:15:00／01／02</span></span><h3>涨停价开竞价</h3><p>初始竞价价 = 今日涨停价</p><small>09:15:00、01、02 中任一有效价格等于今日涨停价即可。</small><span className="auction-rule-symbol"><Clock3 size={15} />精确时点</span></article>
        <article><span className="auction-step">03 <span>09:24:57 → 09:25:05</span></span><h3>竞价尾段抬价</h3><p>09:25 价格 &gt; 09:24:57／58／59 任一价格</p><small>保留 09:25:00–09:25:05 内最新一笔（含 09:25:02），严格大于任一有效时点即可。</small><span className="auction-rule-symbol"><ArrowRight size={15} />尾段确认</span></article>
        <article className="auction-liquidity"><span className="auction-step">04 <span>满足下列任意一项</span></span><h3>竞价放量或放额</h3><label>竞价量 / 昨日成交量 &gt; <span><input aria-label="竞价量占昨日成交量阈值" inputMode="decimal" type="number" min="0.01" max="100" step="any" value={percentInput} onChange={event => { setPercentInput(event.target.value); setRuleError('') }} />%</span></label><div className="auction-or">或</div><label>竞价成交额 &gt; <span><input aria-label="竞价成交额阈值（亿元）" inputMode="decimal" type="number" min="0.0001" step="any" value={amountInput} onChange={event => { setAmountInput(event.target.value); setRuleError('') }} />亿元</span></label><small>使用 09:25 最终竞价成交，不含未匹配委托。</small></article>
      </div>
      <div className="auction-extra-rules" aria-label="固定附加条件"><div><Check size={16} /><div><strong>排除创业板与 ST</strong><p>创业板（300 / 301）及 ST、*ST 等风险警示股票不入选。</p></div></div><div><Check size={16} /><div><strong>09:25 竞价涨幅 ≥ 0%</strong><p>最终竞价价须不低于昨收；低开排除，平开保留。</p></div></div><div><Check size={16} /><div><strong>竞价成交额 ≥ 1000 万元</strong><p>低于 1000 万元不入选；量占比达标也须满足，缺额待核验。</p></div></div></div>
      <div className="auction-rule-footer"><p><Info size={14} />昨日指前一交易日；缺失关键字段时标记待核验。</p><div>{changed && <span>阈值已修改，待应用</span>}<button className="text-button" onClick={() => { setPercentInput('3'); setAmountInput('1'); setRules(DEFAULT_AUCTION_RULES); setRuleError(''); setSelected(null) }}>恢复默认</button><button className="button primary" onClick={applyRules}><ListFilter size={15} />应用条件</button></div></div>
      {ruleError && <p className="form-error auction-rule-error" role="alert">{ruleError}</p>}
    </section>

    <section className="auction-results" aria-labelledby="auction-results-title">
      <div className="auction-result-heading"><div><div className="eyebrow">SCREENING RESULTS</div><h2 id="auction-results-title">竞价观察名单 <span>{dataset ? counts.matched : '—'}</span></h2><p>全部条件曾同时通过即保留入选；同日同条件刷新不移除，已保留记录显示当时快照。</p></div><button className="button secondary" disabled={!dataset || !counts.matched} onClick={() => downloadAuctionJson({ ...dataset, demo, appliedRules: { ...rules, excludeChiNext: true, excludeST: true, minimumAuctionChangePercent: 0, minimumAuctionAmount: MIN_AUCTION_AMOUNT }, records: results.filter(row => row.status === 'matched').map(row => row.record) }, `${demo ? '演示-' : ''}竞价选股-${dataset?.tradeDate}.json`)}><Download size={15} />导出入选</button></div>

      {dataset ? <>
        <div className="auction-funnel" aria-label="逐步筛选统计"><div><span>{automatic ? '自动扫描' : '导入样本'}</span><strong>{results.length}</strong></div>{stages.map((count, index) => <div key={index}><ArrowRight size={14} /><span>{['昨日涨停', '涨停开竞价', '尾段抬价', '量额达标', '附加过滤'][index]}</span><strong>{count}</strong></div>)}</div>
        <div className="panel auction-result-panel"><div className="auction-table-tools"><div className="auction-tabs" role="group" aria-label="筛选状态">{(['matched', 'pending', 'rejected', 'all'] as const).map(value => <button key={value} aria-pressed={filter === value} className={filter === value ? 'active' : ''} onClick={() => setFilter(value)}>{value === 'all' ? '全部样本' : label[value]}<span>{value === 'all' ? results.length : counts[value]}</span></button>)}</div><label className="auction-search"><Search size={15} /><input aria-label="搜索竞价股票" value={search} onChange={event => setSearch(event.target.value)} placeholder="搜索名称 / 代码" /></label></div>
          {rows.length ? <div className="auction-table-scroll"><table className="auction-table"><thead><tr><th>股票 / 状态</th><th>09:15:00／01／02</th><th>09:24:57／58／59</th><th>09:25:00–05</th><th>09:25 涨幅</th><th>竞价量占昨量</th><th>竞价成交额</th><th>条件核验</th></tr></thead><tbody>{rows.map(row => <tr key={row.record.code}><td><strong>{row.record.name}</strong><div className="auction-stock-meta"><span>{row.record.code}</span><span className={`auction-status ${row.status}`}>{label[row.status]}</span>{row.record.retainedMatch && <small>已保留入选</small>}</div></td><td>{auctionOpeningPrices(row.record).some(point => point.price !== null) ? auctionOpeningPrices(row.record).filter(point => point.price !== null).map(point => <div key={point.time}>{price(point.price)}<small> {point.time}</small></div>) : '—'}</td><td>{auctionReferencePrices(row.record).some(point => point.price !== null) ? auctionReferencePrices(row.record).filter(point => point.price !== null).map(point => <div key={point.time}>{price(point.price)}<small> {point.time}</small></div>) : '—'}</td><td className={row.checks[2].status === 'pass' ? 'auction-price-up' : ''}>{price(row.record.price092500)}{row.record.auctionTime && <small> {row.record.auctionTime}</small>}{row.checks[2].status === 'pass' && <small> ↑</small>}</td><td>{row.auctionChangePercent === null ? '—' : `${row.auctionChangePercent > 0 ? '+' : ''}${row.auctionChangePercent.toFixed(2)}%`}</td><td>{row.volumePercent === null ? '—' : `${row.volumePercent.toFixed(2)}%`}</td><td>{row.record.auctionAmount === null ? '—' : <>{(row.record.auctionAmount / 1e8).toFixed(4)}<small> 亿</small></>}</td><td><button className="auction-check-button" onClick={() => setSelected(row)} aria-label={`核验${row.record.name}`}>{row.checks.map((check, index) => <span key={check.label} className={check.status} title={`${check.label}：${checkLabel[check.status]}`}>{index + 1}</span>)}<ChevronDown size={14} /></button></td></tr>)}</tbody></table></div> : <div className="auction-no-results"><Target size={28} /><h3>{search ? '没有匹配的股票' : filter === 'matched' ? '暂无股票同时满足全部条件' : '当前分类暂无股票'}</h3><p>{search ? '调整名称或代码后重试。' : '可切换「全部样本」查看未通过原因和缺失数据。'}</p></div>}
          <div className="auction-table-footer"><span>{demo ? '虚构演示' : automatic ? '自动快照' : '导入样本'} · {dataset.tradeDate} · 当前展示 {rows.length} 条</span><button className="text-button" onClick={() => { request.current?.abort(); setAutomaticMode(false); setLoading(false); setDataset(null); setMatchMemory(null); try { clearAuctionMatches(); setRetentionError('') } catch { setRetentionError('未能清除浏览器中的入选保留记录。') } setDemo(false); setSelected(null) }}>清空快照</button></div>
        </div>
      </> : <div className="panel auction-empty"><div className="auction-empty-visual"><span /><Target size={32} /><span /></div><h3>{loading ? '正在自动扫描昨日涨停股票' : '让每一条竞价信号，有数据可核验'}</h3><p>{loading ? '正在核对交易日期、精确竞价分笔与昨日成交量…' : '可点击「刷新竞价」重试自动取数，也可导入快照核验。'}<br />支持逐项查看筛选依据与缺失字段。</p><div><button className="button primary" onClick={() => setImporting(true)}><Upload size={16} />导入快照，开始筛选</button><button className="button secondary" onClick={() => load(auctionDemo(), true)}><Play size={15} />体验演示数据</button></div><small>自动扫描沪深昨日涨停池 · 精确时点缺失时不补值</small></div>}
    </section>

    <details className="panel auction-data-help"><summary><FileJson size={17} /><strong>数据口径与接入说明</strong><ChevronDown size={16} /></summary><div><p>自动模式以东方财富昨日涨停池确认第 1 项，仅覆盖池内沪深 A 股，不含该池未覆盖的 ST、科创板与未开板新股。今日涨停价来自实时行情，不按固定 10% 反推。精确读取 09:15:00／01／02 和 09:24:57／58／59，开竞价三个时点中任一有效价格等于今日涨停价即可；最终竞价价严格大于后三个时点中任一有效价格即可；最终竞价延长至 09:25:05，取 09:25:00–09:25:05 内最新一笔的价格和成交量，并显示实际采样时间。窗口外及分钟线不补齐缺失。</p><p>附加条件固定启用：排除创业板（深圳 30 开头）及名称带 ST、*ST 等风险警示标识的股票；09:25 最终竞价价须不低于前一交易日收盘价，负涨幅排除，0% 平开保留。缺少昨收或最终竞价价时标记待核验。最终竞价成交额还须 ≥ 1000 万元，低于该值直接排除，恰好 1000 万元保留；成交额缺失时待核验，量占比达标不能替代最低金额。这些条件对自动数据、导入快照和导出名单同样生效。</p><p>成交量统一为“股”，成交额统一为“元”。分笔与未复权日线的“手”均乘 100 换算；最终竞价成交额按 09:25 最终价格 × 成交股数计算，不采用未匹配量、委买量或全天累计成交。最终价格须与当日开盘价一致，3% 和 1 亿元均使用严格大于。</p><p>分笔不单独携带交易日期，按同期实时行情日期、分笔昨收、未复权日线交叉核验。上证指数未复权日线用于确定前一交易日。后端缓存 30 秒并合并并发请求，09:25:05 时失效窗口结束前的缓存；自动模式仅在页面可见时每 30 秒更新，开启自动更新时于 09:25:05 额外强制取数。窗口结束前仅预览、不存档，导入和演示模式暂停更新。公开源延迟、限流、缺时点时保留缺失或旧快照并明确提示。</p><p>自动模式按交易日及已应用阈值保留曾经入选的完整快照，刷新页面后仍可恢复；后续缺失、不满足或源池未返回时显示“已保留入选”。切换日期或阈值重新判断，清空快照会删除本机保留记录，演示和导入模式独立筛选。手动快照的日期与时点由导入文件声明，须核对供应商交易日历和字段定义。导入样本只保存在当前页面，离开或刷新后恢复自动取数。</p>{automatic?.warnings.slice(0, 3).map(message => <p key={message}>{message}</p>)}<table><thead><tr><th>JSON 字段</th><th>含义</th></tr></thead><tbody>{fields.map(([field, description]) => <tr key={field}><td><code>{field}</code></td><td>{description}</td></tr>)}</tbody></table></div></details>
    <p className="auction-disclaimer">规则匹配仅用于竞价观察，未经回测；09:25:05 取数窗口结束后保存最终筛选结果，不代表买入建议或收益预测。</p>

    {importing && <AuctionImport onClose={() => setImporting(false)} onImport={data => { load(data, false); setImporting(false) }} />}
    {selected && <Modal title={`${selected.record.name} · 条件核验`} subtitle={`${demo ? '虚构演示 · ' : ''}${dataset?.tradeDate} · 价格单位：元；成交量单位：股`} onClose={() => setSelected(null)}><div className="auction-check-details"><span className={`auction-status ${selected.status}`}>{label[selected.status]}</span>{selected.checks.map((check, index) => <div className={`auction-check-detail ${check.status}`} key={check.label}><span>{check.status === 'pass' ? <Check size={17} /> : check.status === 'fail' ? <X size={17} /> : <Info size={17} />}</span><div><h3>{index + 1}. {check.label}<small>{checkLabel[check.status]}</small></h3><p>{check.detail}</p></div></div>)}{selected.record.retainedMatch && <p className="auction-check-note">已保留入选：本次刷新缺失、未满足条件或未返回该股，展示此前全部条件通过的完整快照。满足时间：{new Date(selected.record.retainedMatch.matchedAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false })}（北京时间）；来源：{selected.record.retainedMatch.source}。</p>}{selected.record.dataWarnings?.map(message => <p className="auction-check-note" key={message}>{message}</p>)}{automatic && <p className="auction-check-note">成交额按最终竞价价 × 成交股数计算。个股行情时间：{selected.record.quoteAsOf ? new Date(selected.record.quoteAsOf).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }) : '缺失'}。</p>}<p className="auction-check-note">已知不满足任一项即判定未通过；没有已知失败、但缺关键数据时为待核验。第 4 项任一分支已通过，即满足该项。</p></div></Modal>}
  </main>
}

function AuctionImport({ onClose, onImport }: { onClose: () => void; onImport: (data: AuctionDataset) => void }) {
  const [text, setText] = useState(''), [error, setError] = useState(''), [preview, setPreview] = useState<AuctionDataset | null>(null)
  function update(value: string) { setText(value); setError(''); setPreview(null) }
  return <Modal title="导入竞价快照" subtitle="先校验数据与日期，再替换当前页面快照。缺失数值请填写 null。" onClose={onClose} wide><div className="import-content auction-import">
    <label className="file-picker"><Upload size={16} />选择 JSON 文件<input aria-label="选择竞价 JSON 文件" type="file" accept=".json,application/json" onChange={async event => { const file = event.target.files?.[0]; if (!file) return; setPreview(null); setError(''); if (file.size > 5 * 1024 * 1024) { setText(''); setError('文件不能超过 5 MB。'); return } try { update(await file.text()) } catch { setError('文件读取失败，请重新选择。') } }} /></label>
    <label className="csv-label">JSON 快照内容<textarea value={text} onChange={event => update(event.target.value)} placeholder={JSON.stringify(auctionTemplate(), null, 2)} /></label>
    <div className="auction-import-note"><Info size={16} /><p>同一文件仅包含一个交易日。tradeDate 为竞价日，previousTradeDate 为前一交易日。所有价格按元，成交量按股，成交额按元；金额 1 亿应填写 100000000。</p></div>
    <button className="text-button" onClick={() => downloadAuctionJson(auctionTemplate(), '竞价快照模板.json')}><Download size={14} />下载空白模板与字段示例</button>
    {error && <p className="form-error" role="alert">{error}</p>}
    {preview && <div className="import-preview"><Check size={18} /><div><strong>已校验 {preview.records.length} 条股票快照</strong><p>竞价日 {preview.tradeDate} / 前一交易日 {preview.previousTradeDate}</p><p>来源：{preview.source}</p><p>导入后替换当前快照；缺失字段会在条件核验中显示。</p></div></div>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button>{preview ? <button className="button primary" onClick={() => onImport(preview)}>确认导入 {preview.records.length} 条</button> : <button className="button primary" onClick={() => { try { if (text.length > 5 * 1024 * 1024) throw new Error('内容不能超过 5 MB。'); setPreview(parseAuctionDataset(text)); setError('') } catch (err) { setError(err instanceof Error ? err.message : '快照格式无效。') } }}>校验并预览</button>}</div>
  </div></Modal>
}
