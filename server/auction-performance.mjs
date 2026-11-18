const dateInChina = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(time))
const timeInChina = time => new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false }).format(new Date(time))
const validDate = value => /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const positive = value => value !== null && value !== '' && Number.isFinite(Number(value)) && Number(value) > 0 ? Number(value) : null
function dailyUrl(code, begin, end) {
  return `https://push2his.eastmoney.com/api/qt/stock/kline/get?${new URLSearchParams({ secid: `${code.startsWith('SH') ? 1 : 0}.${code.slice(2)}`, fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57', klt: '101', fqt: '0', beg: begin.replaceAll('-', ''), end: end.replaceAll('-', ''), lmt: '500' })}`
}
export function createAuctionPerformance(fetcher = fetch, now = Date.now) {
  const cache = new Map(), inflight = new Map()
  let calendarCache, calendarInflight
  async function json(url, options = {}) {
    const response = await fetcher(url, { signal: AbortSignal.timeout(15000), ...options })
    if (!response.ok) throw new Error('行情源请求失败')
    return response.json()
  }
  async function calendar(today) {
    if (calendarCache?.date === today && now() - calendarCache.at < 60000) return calendarCache.dates
    if (calendarInflight) return calendarInflight
    const begin = new Date(`${today}T00:00:00Z`); begin.setUTCDate(begin.getUTCDate() - 400)
    calendarInflight = (async () => {
      const raw = await json(dailyUrl('SH000001', begin.toISOString().slice(0, 10), today))
      if (raw.data?.code !== '000001' || !Array.isArray(raw.data.klines)) throw new Error('交易日历不可用')
      const dates = [...new Set(raw.data.klines.map(line => typeof line === 'string' ? line.split(',')[0] : '').filter(date => validDate(date) && date <= today))].sort()
      if (!dates.length) throw new Error('交易日历为空')
      calendarCache = { date: today, at: now(), dates }; return dates
    })().finally(() => { calendarInflight = null })
    return calendarInflight
  }
  return async function getPerformance(code, tradeDate, force = false) {
    const today = dateInChina(now()), currentTime = timeInChina(now())
    if (!/^(SH6\d{5}|SZ[03]\d{5})$/.test(code) || !validDate(tradeDate) || tradeDate > today || Date.parse(today) - Date.parse(tradeDate) > 370 * 86400000) throw new Error('代码或入选日期无效，仅支持最近一年已发生的入选日')
    const key = `${code}|${tradeDate}`
    if (!force && cache.has(key) && now() - cache.get(key).at < 60000) return cache.get(key).data
    if (inflight.has(key)) return inflight.get(key)
    const task = (async () => {
      const result = { code, tradeDate, status: 'missing', entry: null, exit: null, nextTradeDate: null, latest: null, warnings: [], fetchedAt: new Date(now()).toISOString(), source: '新浪历史成交分笔（买价） · 东方财富未复权日线（收盘价与日历）' }
      const [dates, raw] = await Promise.all([calendar(today), json(dailyUrl(code, tradeDate, today))])
      if (!dates.includes(tradeDate)) { result.warnings.push('入选日不在已取得的交易日历中'); return result }
      if (raw.data?.code !== code.slice(2) || !Array.isArray(raw.data.klines)) { result.warnings.push('个股日线暂不可用'); return result }
      const lines = raw.data.klines.map(line => typeof line === 'string' ? line.split(',') : []).filter(parts => validDate(parts[0]) && parts[0] >= tradeDate && parts[0] <= today)
      const entryBar = lines.find(parts => parts[0] === tradeDate)
      const last = lines.at(-1)
      if (last && positive(last[2])) result.latest = { date: last[0], price: positive(last[2]), final: last[0] < today || currentTime >= '15:00:00' }
      result.nextTradeDate = dates[dates.indexOf(tradeDate) + 1] ?? null
      if (tradeDate === today && currentTime < '09:30:00') { result.status = 'waiting_entry'; result.warnings.push('09:30 连续交易尚未开始'); return result }
      if (!entryBar) { result.warnings.push('入选日没有个股日线，不能确认当日成交'); return result }
      const symbol = code.toLowerCase()
      const query = new URLSearchParams({ symbol, num: '60', page: '1', sort: 'ticktime', asc: '1', volume: '0', amount: '0', type: '0', day: tradeDate })
      let ticks
      try { ticks = await json(`https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_Bill.GetBillList?${query}`, { headers: { Referer: `https://vip.stock.finance.sina.com.cn/quotes_service/view/cn_bill.php?symbol=${symbol}`, 'User-Agent': 'Mozilla/5.0' } }) }
      catch { result.warnings.push('历史成交分笔暂不可用，未用日线开盘或竞价成交替代买价'); return result }
      if (!Array.isArray(ticks) || !ticks.length || ticks.some(row => row.symbol !== symbol)) { result.warnings.push('没有取得该入选日的成交分笔，未用日线开盘价替代'); return result }
      const opening = ticks.find(row => row.ticktime === '09:25:00')
      if (!opening || Math.round(Number(opening.price) * 100) !== Math.round(Number(entryBar[1]) * 100)) { result.warnings.push('分笔竞价价与当日日线开盘价不符，历史日期无法交叉核验'); return result }
      if (ticks.some((row, index) => index && row.ticktime < ticks[index - 1].ticktime) || ticks[0].ticktime !== '09:25:00') { result.warnings.push('分笔没有从当日首笔按时间升序返回，不能确认 09:30 后首笔'); return result }
      const first = ticks.find(row => typeof row.ticktime === 'string' && ((row.ticktime >= '09:30:00' && row.ticktime <= '11:30:00') || (row.ticktime >= '13:00:00' && row.ticktime < '14:57:00')) && positive(row.price) && positive(row.volume))
      if (!first) { result.warnings.push('源首屏没有 09:30 后连续交易分笔'); return result }
      result.entry = { date: tradeDate, time: first.ticktime, price: positive(first.price), volume: positive(first.volume) }
      if (!result.nextTradeDate || result.nextTradeDate === today && currentTime < '15:00:00') { result.status = 'waiting_exit'; result.warnings.push('次一交易日尚未收盘，不提前生成卖出价或已实现盈亏'); return result }
      const exitBar = lines.find(parts => parts[0] === result.nextTradeDate)
      if (!exitBar || !positive(exitBar[2])) { result.warnings.push('次一交易日没有收盘行情（可能停牌或缺数），未拿下一根日线冒充次日'); return result }
      result.exit = { date: result.nextTradeDate, price: positive(exitBar[2]) }; result.status = 'complete'
      result.warnings.push('本结果为买卖时点价格测算；次日涨跌停、停牌成交能力及除权分红仍须核验，不能视为真实成交。')
      return result
    })().then(data => {
      if (cache.size > 2000) cache.clear()
      cache.set(key, { at: now(), data }); return data
    }).finally(() => inflight.delete(key))
    inflight.set(key, task); return task
  }
}
