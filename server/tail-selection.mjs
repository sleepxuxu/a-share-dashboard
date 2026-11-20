import { normalizeMarketStock } from './market.mjs'

const fields = 'f2,f3,f6,f7,f8,f10,f12,f13,f14,f15,f16,f18,f21,f62,f100,f124'
const chinaDate = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(value))
const valid = value => typeof value === 'number' && Number.isFinite(value)

// These are only the four numerical gates. Intraday and historical evidence is reviewed separately.
export function tailChecks(stock) {
  return [
    valid(stock.change) ? stock.change >= 3 && stock.change <= 5 : null,
    valid(stock.volumeRatio) ? stock.volumeRatio >= 1 : null,
    valid(stock.turnover) ? stock.turnover >= 5 && stock.turnover <= 10 : null,
    valid(stock.floatCap) ? stock.floatCap >= 50e8 && stock.floatCap <= 200e8 : null,
  ]
}

export function createTailSelectionService(fetcher = fetch, now = Date.now) {
  const services = new Map()
  return (force = false, market = 'main') => {
    const scope = market === 'all' ? 'all' : 'main'
    if (!services.has(scope)) services.set(scope, createScopedTailSelectionService(fetcher, now, scope))
    return services.get(scope)(force)
  }
}

function createScopedTailSelectionService(fetcher, now, market) {
  let cached = null, inflight = null
  async function get(url) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(8000), headers: { Accept: 'application/json' } })
    if (!response.ok) throw new Error('公开行情源暂不可用')
    const body = await response.json()
    if (!Array.isArray(body.data?.diff)) throw new Error('公开行情格式异常')
    return body.data
  }
  return async function load(force = false) {
    if (!force && cached && now() - cached.at < 60000) return cached.value
    if (inflight) return inflight
    inflight = (async () => {
      const indexPromise = get('https://push2.eastmoney.com/api/qt/ulist.np/get?secids=1.000001%2C0.399001%2C0.399006&fields=f2,f3,f12,f14,f124&fltt=2').then(
        body => body.diff.map(row => ({ code: row.f12, name: row.f14, price: valid(row.f2) ? row.f2 : null, change: valid(row.f3) ? row.f3 : null, asOf: valid(row.f124) && row.f124 > 0 ? new Date(row.f124 * 1000).toISOString() : null })),
        () => [],
      )
      const stocks = new Map(), warnings = []
      let total = 0, exhausted = false, pages = 0
      // Bounded scan of the descending change ranking; disclose any incomplete coverage.
      for (let page = 1; page <= 10; page++) {
        const params = new URLSearchParams({ pn: String(page), pz: '100', po: '1', np: '1', fltt: '2', invt: '2', fid: 'f3', fs: market === 'all' ? 'm:0+t:6,m:0+t:80,m:1+t:2,m:1+t:23' : 'm:0+t:6,m:1+t:2', fields })
        let body
        try { body = await get(`https://push2.eastmoney.com/api/qt/clist/get?${params}`) }
        catch (error) { if (!stocks.size) throw error; warnings.push('部分排行页读取失败，本次扫描不完整。'); break }
        pages++
        total = valid(body.total) ? body.total : 0
        const before = stocks.size
        for (const row of body.diff) {
          const stock = normalizeMarketStock(row)
          if (stock && (market === 'all' || /^(SH60\d{4}|SZ00\d{4})$/.test(stock.code)) && !/ST|退/i.test(stock.name)) stocks.set(stock.code, { ...stock, floatCap: valid(row.f21) && row.f21 > 0 ? row.f21 : null })
        }
        if (!body.diff.length || total > 0 && page * 100 >= total || body.diff.length === 100 && valid(body.diff.at(-1).f3) && body.diff.at(-1).f3 < 3) { exhausted = true; break }
        if (page > 1 && stocks.size === before) { warnings.push('排行分页出现重复记录，已停止扫描。'); break }
      }
      const indices = await indexPromise
      const timestamps = [...stocks.values()].map(stock => Date.parse(stock.asOf)).filter(value => Number.isFinite(value) && value > 0)
      if (!timestamps.length) throw new Error('行情缺少有效时间戳，请稍后刷新')
      const asOf = Math.max(...timestamps), marketDate = chinaDate(asOf)
      const latest = [...stocks.values()].filter(stock => stock.asOf && chinaDate(Date.parse(stock.asOf)) === marketDate && asOf - Date.parse(stock.asOf) <= 300000)
      const stages = [latest.length]
      let pool = latest
      for (let gate = 0; gate < 4; gate++) { pool = pool.filter(stock => tailChecks(stock)[gate] === true); stages.push(pool.length) }
      const candidates = latest.filter(stock => tailChecks(stock)[0] === true).map(stock => ({ ...stock, gates: tailChecks(stock) }))
        .sort((a, b) => b.gates.filter(value => value === true).length - a.gates.filter(value => value === true).length || b.amount - a.amount || a.code.localeCompare(b.code))
      const isToday = marketDate === chinaDate(now()), stale = !isToday || now() - asOf > 300000 || asOf > now() + 60000
      if (!exhausted) warnings.push('最多扫描涨幅排行前 1000 条，不能视为全市场完整结果；未扫描不等于未通过。')
      if (!isToday) warnings.push('当前为历史交易日快照，仅供复盘。')
      else if (stale) warnings.push('行情已延迟或时间异常，请刷新后复核。')
      if (!indices.length) warnings.push('指数数据未取得，大盘趋势待核实。')
      const value = { asOf: new Date(asOf).toISOString(), fetchedAt: new Date(now()).toISOString(), marketDate, market, isToday, stale, demo: false, indices, candidates, stages, scannedCount: latest.length, total, pages,
        scope: `${market === 'main' ? '沪深主板涨幅排行，排除创业板、科创板' : '全部沪深 A 股涨幅排行，包含创业板、科创板'}，已读取 ${pages} 页；排除 ST / 退市标记。最多 1000 条，分页期间行情可能变化。`,
        warnings, source: { name: '东方财富公开行情', url: 'https://quote.eastmoney.com/center/gridlist.html#hs_a_board' } }
      cached = { at: now(), value }
      return value
    })().finally(() => { inflight = null })
    try { return await inflight }
    catch (error) { if (cached) return { ...cached.value, stale: true, warnings: [...cached.value.warnings, '刷新失败，保留上次成功快照。'] }; throw error }
  }
}
