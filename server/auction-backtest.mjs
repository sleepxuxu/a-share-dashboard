const dateInChina = time => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date(time))

// A calendar is available, but the current live auction provider has no dated
// historical snapshot contract. Never turn its current ticks into past signals.
export function createAuctionBacktestCoverage(fetcher = fetch, now = Date.now) {
  let cache, inflight
  return async function getCoverage(force = false) {
    const today = dateInChina(now())
    if (!force && cache?.today === today && now() - cache.at < 600000) return cache.data
    if (inflight) return inflight
    inflight = (async () => {
      const end = new Date(`${today}T00:00:00Z`)
      end.setUTCDate(end.getUTCDate() - 1)
      const start = new Date(`${today}T00:00:00Z`)
      start.setUTCFullYear(start.getUTCFullYear() - 1)
      const from = start.toISOString().slice(0, 10), to = end.toISOString().slice(0, 10)
      start.setUTCDate(start.getUTCDate() - 30)
      const query = new URLSearchParams({ secid: '1.000001', fields1: 'f1,f2,f3,f4,f5,f6', fields2: 'f51,f52,f53,f54,f55,f56,f57', klt: '101', fqt: '0', beg: start.toISOString().slice(0, 10).replaceAll('-', ''), end: to.replaceAll('-', ''), lmt: '500' })
      const response = await fetcher(`https://push2his.eastmoney.com/api/qt/stock/kline/get?${query}`, { signal: AbortSignal.timeout(15000) })
      if (!response.ok) throw new Error('回测交易日历暂不可用，请重试')
      const raw = await response.json()
      if (raw.data?.code !== '000001' || !Array.isArray(raw.data.klines)) throw new Error('回测交易日历格式异常')
      const dates = [...new Set(raw.data.klines.map(line => typeof line === 'string' ? line.split(',')[0] : '').filter(date => /^\d{4}-\d{2}-\d{2}$/.test(date) && date <= to))].sort()
      const sessions = dates.filter(date => date >= from), previousTradeDate = dates.filter(date => date < from).at(-1)
      // Prevent a truncated/stale response from silently redefining a year.
      if (sessions.length < 180 || !previousTradeDate || to > dates.at(-1) && Date.parse(to) - Date.parse(dates.at(-1)) > 10 * 86400000) throw new Error('近一年交易日历不完整，无法核验覆盖率')
      const data = { startDate: from, endDate: sessions.at(-1), previousTradeDate, sessions, fetchedAt: new Date(now()).toISOString(), source: '东方财富 · 上证指数未复权日线交易日历', historicalAuctionAvailable: false,
        missing: ['逐日完整的昨日涨停候选池及当时 ST 状态', '09:15:00、09:24:57、09:25:00 历史竞价快照', '入选股票 09:30 后首笔可成交分笔、每日估值及交易限制'],
        explanation: '当前竞价接口只返回最新交易日；历史日期参数不能取得历史快照。仅凭日线或 09:25 成交不能还原完整策略。需接入包含这些时点的历史源，或导入已留存的完整历史档案。' }
      cache = { today, at: now(), data }
      return data
    })().finally(() => { inflight = null })
    return inflight
  }
}
