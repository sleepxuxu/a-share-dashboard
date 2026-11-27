import { candidateDaily, validateCandidates } from './auction-candidates.mjs'

const UT = '7eea3edcaed734bea9cbfc24409ed989'
const validCode = (code) => /^(SH6\d{5}|SZ[03]\d{5})$/.test(code)
const numeric = (value) =>
  value !== '' &&
  value !== null &&
  value !== undefined &&
  value !== '-' &&
  Number.isFinite(Number(value))
    ? Number(value)
    : null
const positive = (value) => (numeric(value) > 0 ? Number(value) : null)
const samePrice = (a, b) =>
  a !== null && b !== null && Math.round(a * 100) === Math.round(b * 100)
const chinaDate = (timestamp) =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(
    new Date(timestamp),
  )
const chinaTime = (timestamp) =>
  new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Shanghai',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(new Date(timestamp))
const secid = (code) => `${code.startsWith('SH') ? '1' : '0'}.${code.slice(2)}`
const dateNumber = (value) => Number(value.replaceAll('-', ''))

export function auctionUrls(code) {
  const id = secid(code)
  return {
    quote: `https://push2.eastmoney.com/api/qt/stock/get?secid=${id}&fields=f46,f51,f57,f58,f60,f86&fltt=2`,
    // pos=0 requests the beginning of the session; iscca=1 includes indicative auction ticks.
    ticks: `https://push2.eastmoney.com/api/qt/stock/details/get?secid=${id}&fields1=f1,f2,f3,f4,f5&fields2=f51,f52,f53,f54,f55&pos=0&iscca=1&fltt=2`,
    daily: `https://push2his.eastmoney.com/api/qt/stock/kline/get?secid=${id}&fields1=f1,f2,f3,f4,f5,f6&fields2=f51,f52,f53,f54,f55,f56,f57&klt=101&fqt=0&lmt=15&end=20500101`,
  }
}

export function parseAuctionTicks(data, expectedCode, asOf = '23:59:59') {
  if (
    !data ||
    data.code !== expectedCode.slice(2) ||
    Number(data.market) !== (expectedCode.startsWith('SH') ? 1 : 0) ||
    !Array.isArray(data.details)
  )
    throw new Error('竞价分笔代码或格式不匹配')
  const grouped = new Map()
  for (const raw of data.details) {
    if (typeof raw !== 'string') continue
    const parts = raw.split(','),
      time = parts[0]
    if (
      ![
        '09:15:00',
        '09:15:01',
        '09:15:02',
        '09:24:57',
        '09:24:58',
        '09:24:59',
      ].includes(time) &&
      !/^09:25:0[0-5]$/.test(time)
    )
      continue
    if (time > asOf) continue
    const price = positive(parts[1]),
      hands = numeric(parts[2])
    const volume =
      hands !== null && hands >= 0 && Number.isSafeInteger(hands * 100)
        ? hands * 100
        : null
    const tick = { time, price, volume }
    if (!grouped.has(time)) grouped.set(time, [])
    grouped.get(time).push(tick)
  }
  const result = {}
  for (const time of [
    '09:15:00',
    '09:15:01',
    '09:15:02',
    '09:24:57',
    '09:24:58',
    '09:24:59',
    ...Array.from(grouped.keys()).filter((time) => time >= '09:25:00'),
  ]) {
    const rows = grouped.get(time) || []
    // Never silently select one of conflicting snapshots at an identical timestamp.
    result[time] =
      rows.length &&
      rows.every(
        (row) => row.price === rows[0].price && row.volume === rows[0].volume,
      )
        ? rows[0]
        : null
  }
  // Accept final auction prints through 09:25:05. Keep price and volume from the same latest print.
  const finalTime = Array.from(grouped.keys())
    .filter((time) => time >= '09:25:00')
    .sort()
    .at(-1)
  result['09:25:00'] = finalTime ? result[finalTime] : null
  return result
}

export function buildAuctionRecord({
  code,
  name,
  quote,
  daily,
  ticks,
  tradeDate,
  previousTradeDate,
  sourceFailures = [],
}) {
  const warnings = [...sourceFailures]
  const record = {
    code,
    name,
    previousClose: null,
    previousLimitUpPrice: null,
    previousLimitUpVerified: true,
    previousVolume: null,
    limitUpPrice: null,
    price091500: null,
    price091501: null,
    price091502: null,
    price092457: null,
    price092458: null,
    price092459: null,
    price092500: null,
    auctionVolume: null,
    auctionAmount: null,
    dataWarnings: warnings,
  }
  if (daily?.code === code.slice(2) && Array.isArray(daily.klines)) {
    const previous = daily.klines
      .find(
        (line) =>
          typeof line === 'string' && line.startsWith(previousTradeDate + ','),
      )
      ?.split(',')
    if (previous) {
      record.previousClose = positive(previous[2])
      const hands = numeric(previous[5])
      record.previousVolume =
        hands !== null && hands > 0 && Number.isSafeInteger(hands * 100)
          ? hands * 100
          : null
    }
  }
  if (record.previousVolume === null)
    warnings.push('缺少前一交易日未复权日线成交量')
  const timestamp = positive(quote?.f86),
    quoteDate = timestamp ? chinaDate(timestamp * 1000) : null
  if (!quote || quote.f57 !== code.slice(2) || quoteDate !== tradeDate) {
    warnings.push('个股行情日期与本轮交易日不一致，未采用竞价数据')
    return record
  }
  record.quoteAsOf = new Date(timestamp * 1000).toISOString()
  record.limitUpPrice = positive(quote.f51)
  if (!samePrice(record.previousClose, positive(quote.f60))) {
    warnings.push('昨收与未复权日线不一致，未采用竞价数据')
    return record
  }
  if (!ticks || !samePrice(positive(ticks.prePrice), record.previousClose)) {
    warnings.push('竞价分笔昨收缺失或与本轮行情不一致')
    return record
  }
  const elapsed = chinaTime(timestamp * 1000)
  let points
  try {
    points = parseAuctionTicks(ticks, code, elapsed)
  } catch {
    warnings.push('竞价分笔格式不匹配')
    return record
  }
  for (const [time, field] of [
    ['09:15:00', 'price091500'],
    ['09:15:01', 'price091501'],
    ['09:15:02', 'price091502'],
    ['09:24:57', 'price092457'],
    ['09:24:58', 'price092458'],
    ['09:24:59', 'price092459'],
    ['09:25:00', 'price092500'],
  ]) {
    if (elapsed < time) {
      warnings.push(`${time} 尚未形成`)
      continue
    }
    const point = points[time]
    if (!point || point.price === null) {
      if (time.startsWith('09:15:') || time.startsWith('09:24:')) continue
      warnings.push(
        time === '09:25:00'
          ? '缺少 09:25:00–09:25:05 竞价快照'
          : `缺少精确 ${time} 快照，未用邻近时点替代`,
      )
      continue
    }
    if (record.limitUpPrice !== null && point.price > record.limitUpPrice) {
      warnings.push(`${time} 价格高于今日涨停价，未采用`)
      continue
    }
    record[field] = point.price
  }
  if (
    elapsed >= '09:15:00' &&
    ['price091500', 'price091501', 'price091502'].every(
      (field) => record[field] === null,
    )
  )
    warnings.push('缺少有效的 09:15:00／01／02 精确快照，开竞价条件待核验')
  if (
    elapsed >= '09:24:57' &&
    ['price092457', 'price092458', 'price092459'].every(
      (field) => record[field] === null,
    )
  )
    warnings.push('缺少有效的 09:24:57／58／59 精确快照，尾段比较待核验')
  const final = points['09:25:00']
  if (record.price092500 !== null) {
    if (!samePrice(record.price092500, positive(quote.f46))) {
      record.price092500 = null
      warnings.push('09:25 分笔与当日开盘价不一致，最终竞价数据待核验')
    } else if (final?.volume !== null && final?.volume !== undefined) {
      record.auctionVolume = final.volume
      // The opening call auction clears at a single price. Volume is converted from lots to shares.
      record.auctionAmount =
        (Math.round(record.price092500 * 100) * final.volume) / 100
    } else warnings.push('09:25 竞价成交量缺失，无法计算竞价成交额')
    if (record.price092500 !== null) record.auctionTime = final.time
  }
  return record
}

async function getJson(
  url,
  fetcher,
  { signal, timeoutMs = 10000, attempts = 2 } = {},
) {
  let lastError
  for (let attempt = 0; attempt < attempts; attempt++) {
    signal?.throwIfAborted()
    try {
      const response = await fetcher(url, {
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
        headers: { Accept: 'application/json', 'User-Agent': 'Gujian/0.4' },
      })
      if (!response.ok) throw new Error('竞价数据源响应异常')
      const body = await response.json()
      if (body.rc !== 0 || !body.data) throw new Error('竞价数据源暂无数据')
      return body.data
    } catch (error) {
      signal?.throwIfAborted()
      lastError = error
    }
  }
  throw lastError
}

async function mapLimit(items, limit, fn, signal) {
  const output = new Array(items.length)
  let next = 0
  await Promise.all(
    Array.from({ length: Math.min(items.length, limit) }, async () => {
      while (next < items.length) {
        signal?.throwIfAborted()
        const index = next++
        output[index] = await fn(items[index])
      }
    }),
  )
  return output
}

export function createAuctionService(fetcher = fetch, now = Date.now, candidateStore = null) {
  let cache = null,
    inflight = null,
    staticDate = null
  const staticCache = new Map()
  const prepared = new Map()
  return async function getAuction(force = false) {
    const startedAt = now()
    const today = chinaDate(startedAt)
    const cutoff = Date.parse(`${today}T09:25:05+08:00`)
    const crossedCutoff =
      cache && cache.startedAt < cutoff && startedAt >= cutoff
    if (
      !force &&
      cache &&
      chinaDate(cache.at) === today &&
      !crossedCutoff &&
      startedAt - cache.at < 30000
    )
      return cache.value
    const previousTask = inflight
    if (previousTask) {
      const crossedDay = chinaDate(previousTask.startedAt) !== today
      if (
        !crossedDay &&
        (previousTask.startedAt >= cutoff || startedAt < cutoff)
      )
        return previousTask.promise
      // A preview may still be fetching when the final window closes. Cancel it
      // and let all its callers join a new scan instead of returning old quotes.
      previousTask.controller.abort()
    }
    if (staticDate !== today) {
      staticCache.clear()
      staticDate = today
    }
    const task = { startedAt, controller: new AbortController(), promise: null }
    if (previousTask) previousTask.replacement = task
    const { signal } = task.controller
    inflight = task
    task.promise = (async () => {
      const diagnostics = {
        startedAt: new Date(startedAt).toISOString(),
        durationMs: 0,
        requestCount: 0,
        cacheHitCount: 0,
        referenceMs: 0,
        calendarMs: 0,
        poolMs: 0,
        stocksMs: 0,
        persistedPool: false,
        persistedDailyCount: 0,
      }
      const storageWarnings = []
      const read = (url, options) =>
        getJson(
          url,
          (input, init) => {
            diagnostics.requestCount++
            return fetcher(input, init)
          },
          { ...options, signal },
        )
      const live = (url) => read(url, { timeoutMs: 4000, attempts: 1 })
      const timed = async (field, fn) => {
        const begin = now()
        try {
          return await fn()
        } finally {
          diagnostics[field] = Math.max(0, now() - begin)
        }
      }
      const cached = async (key, url, ttl, valid, options) => {
        const saved = staticCache.get(key)
        if (saved && now() - saved.at < ttl) {
          diagnostics.cacheHitCount++
          return saved.value
        }
        const value = await read(url, options)
        signal.throwIfAborted()
        if (valid(value)) staticCache.set(key, { at: now(), value })
        return value
      }
      const benchmark = auctionUrls('SH000001')
      const [reference, calendar] = await Promise.all([
        timed('referenceMs', () => live(benchmark.quote)),
        timed('calendarMs', () =>
          cached(
            `calendar:${today}`,
            benchmark.daily,
            300000,
            (data) =>
              data.code === '000001' &&
              Array.isArray(data.klines) &&
              data.klines.length > 0,
          ),
        ),
      ])
      const timestamp = positive(reference.f86)
      if (
        !timestamp ||
        reference.f57 !== '000001' ||
        calendar.code !== '000001'
      )
        throw new Error('无法确认竞价交易日期')
      const tradeDate = chinaDate(timestamp * 1000)
      const dates = (calendar.klines || [])
        .filter((line) => typeof line === 'string')
        .map((line) => line.split(',')[0])
        .filter(
          (value) => /^\d{4}-\d{2}-\d{2}$/.test(value) && value < tradeDate,
        )
        .sort()
      const previousTradeDate = dates.at(-1)
      if (!previousTradeDate) throw new Error('无法确认前一交易日')
      let candidates = prepared.get(previousTradeDate)
      if (!candidates && candidateStore) {
        try {
          candidates = validateCandidates(await candidateStore.load(previousTradeDate), previousTradeDate)
          if (candidates && Date.parse(candidates.savedAt) > now() + 60000) candidates = null
          if (candidates) {
            prepared.clear()
            prepared.set(previousTradeDate, candidates)
          }
        } catch { storageWarnings.push('已保存的候选池读取失败，本轮重新获取源池。') }
      }
      diagnostics.persistedPool = !!candidates
      const savedStocks = new Map(candidates?.stocks.map(stock => [stock.code, stock]) ?? [])
      const pool = candidates ? {
        qdate: dateNumber(tradeDate), tc: candidates.stocks.length,
        pool: candidates.stocks.map(stock => ({ m: stock.code.startsWith('SH') ? 1 : 0, c: stock.code.slice(2), n: stock.name })),
      } : await timed('poolMs', () =>
        cached(
          `pool:${tradeDate}`,
          `https://push2ex.eastmoney.com/getYesterdayZTPool?${new URLSearchParams({ ut: UT, dpt: 'wz.ztzt', Pageindex: '0', pagesize: '5000', sort: 'zs:desc', date: String(dateNumber(tradeDate)) })}`,
          60000,
          (data) =>
            Number(data.qdate) === dateNumber(tradeDate) &&
            Array.isArray(data.pool) &&
            data.pool.length > 0 &&
            Number(data.tc) === data.pool.length,
        ),
      )
      if (
        Number(pool.qdate) !== dateNumber(tradeDate) ||
        !Array.isArray(pool.pool)
      )
        throw new Error('昨日涨停池日期或格式不匹配')
      if (Number(pool.tc) !== pool.pool.length)
        throw new Error('昨日涨停池返回不完整，请稍后刷新')
      const seen = new Set()
      const stocks = pool.pool
        .map((row) => ({
          code: (row.m === 1 ? 'SH' : 'SZ') + row.c,
          name: row.n,
        }))
        .filter((stock) => {
          if (
            !validCode(stock.code) ||
            typeof stock.name !== 'string' ||
            seen.has(stock.code)
          )
            return false
          seen.add(stock.code)
          return true
        })
      if (stocks.length > 500)
        throw new Error('昨日涨停池超出单次扫描上限（500 只）')
      const dailySnapshots = new Map()
      const records = await timed('stocksMs', () =>
        mapLimit(
          stocks,
          8,
          async (stock) => {
            const urls = auctionUrls(stock.code)
            const savedDaily = candidateDaily(savedStocks.get(stock.code)?.daily, stock.code, previousTradeDate)
            if (savedDaily) diagnostics.persistedDailyCount++
            const results = await Promise.allSettled([
              live(urls.quote),
              savedDaily ? Promise.resolve(savedDaily) : cached(
                `daily:${tradeDate}:${previousTradeDate}:${stock.code}`,
                urls.daily,
                Infinity,
                (data) =>
                  data.code === stock.code.slice(2) &&
                  Array.isArray(data.klines) &&
                  data.klines.some((line) => {
                    if (typeof line !== 'string') return false
                    const parts = line.split(',')
                    return (
                      parts[0] === previousTradeDate &&
                      positive(parts[2]) !== null &&
                      positive(parts[5]) !== null &&
                      Number.isSafeInteger(Number(parts[5]) * 100)
                    )
                  }),
                { timeoutMs: 4000, attempts: 1 },
              ),
              live(urls.ticks),
            ])
            signal.throwIfAborted()
            const [quote, daily, ticks] = results.map((result) =>
              result.status === 'fulfilled' ? result.value : null,
            )
            dailySnapshots.set(stock.code, candidateDaily(daily, stock.code, previousTradeDate))
            const sourceFailures = results.flatMap((result, index) =>
              result.status === 'rejected'
                ? [
                    [
                      '实时行情读取失败',
                      '未复权日线读取失败',
                      '竞价分笔读取失败',
                    ][index],
                  ]
                : [],
            )
            return buildAuctionRecord({
              ...stock,
              name: typeof quote?.f58 === 'string' && quote.f58.trim() ? quote.f58 : stock.name,
              quote,
              daily,
              ticks,
              tradeDate,
              previousTradeDate,
              sourceFailures,
            })
          },
          signal,
        ),
      )
      signal.throwIfAborted()
      let candidateSaved = !!candidates
      if (candidateStore && stocks.length && (!candidates || diagnostics.persistedDailyCount < stocks.length)) {
        const bundle = { schemaVersion: 1, sourceDate: previousTradeDate, origin: 'previous', savedAt: new Date(now()).toISOString(),
          stocks: stocks.map(stock => ({ ...stock, daily: dailySnapshots.get(stock.code) ?? null })) }
        try {
          await candidateStore.save(bundle)
          candidateSaved = true
          prepared.clear()
          prepared.set(previousTradeDate, bundle)
        } catch { storageWarnings.push('本轮候选池未能持久保存，仍可查看竞价结果。') }
      }
      signal.throwIfAborted()
      const fetchedAt = new Date(now()).toISOString(),
        isToday = tradeDate === chinaDate(now()),
        elapsed = chinaTime(timestamp * 1000)
      const warnings = [
        '扫描范围为东方财富已核验涨停池中的沪深 A 股；不含源池未覆盖的股票，非全市场穷举。',
        '分笔不单独携带交易日期；按同期实时行情日期、分笔昨收与未复权日线交叉核验。',
        '竞价成交额按 09:25 最终价格 × 成交股数计算，未使用全天成交额。',
        ...storageWarnings,
      ]
      if (!isToday)
        warnings.push('当前为最近交易日的历史快照，不代表今日竞价。')
      if (elapsed < '09:25:05')
        warnings.push(
          '09:25:05 竞价取数窗口尚未结束；当前结果仅供预览，暂不存档。',
        )
      const incomplete = records.filter(
        (row) =>
          ['price091500', 'price091501', 'price091502'].every(
            (field) => row[field] === null,
          ) ||
          ['price092457', 'price092458', 'price092459'].every(
            (field) => row[field] === null,
          ) ||
          [
            'price092500',
            'auctionVolume',
            'previousVolume',
            'limitUpPrice',
          ].some((field) => row[field] === null),
      ).length
      if (incomplete)
        warnings.push(
          `${incomplete} 只股票存在缺失或未通过数据核验的字段，请查看逐股说明。`,
        )
      const value = {
        schemaVersion: 1,
        tradeDate,
        previousTradeDate,
        source: `东方财富 · ${candidates?.origin === 'closing' ? '已保存收盘涨停池' : '昨日涨停池'} / 含竞价分笔 / 实时行情 / 未复权日线`,
        records,
        automatic: {
          fetchedAt,
          asOf: new Date(timestamp * 1000).toISOString(),
          isToday,
          stale:
            !isToday ||
            now() - timestamp * 1000 > 5 * 60000 ||
            timestamp * 1000 - now() > 60000,
          poolCount: pool.pool.length,
          scannedCount: records.length,
          incompleteCount: incomplete,
          candidatePool: { sourceDate: previousTradeDate, persisted: candidateSaved, reused: !!candidates, stockCount: stocks.length, dailyCount: [...dailySnapshots.values()].filter(Boolean).length },
          diagnostics: {
            ...diagnostics,
            durationMs: Math.max(0, now() - startedAt),
          },
          warnings,
        },
      }
      cache = { at: now(), startedAt, value }
      return value
    })()
      .catch((error) => {
        if (task.replacement) return task.replacement.promise
        if (cache)
          return {
            ...cache.value,
            automatic: {
              ...cache.value.automatic,
              stale: true,
              warnings: [
                ...cache.value.automatic.warnings,
                '本次自动取数失败，保留上次成功快照，请留意交易日期。',
              ],
            },
          }
        throw error
      })
      .finally(() => {
        if (inflight === task) inflight = null
      })
    return task.promise
  }
}

export function createAuctionPreparation(fetcher = fetch, now = Date.now, candidateStore = null) {
  let inflight = null
  return async function prepareCandidates() {
    if (!candidateStore) throw new Error('候选池持久化存储尚未配置')
    if (inflight) return inflight
    inflight = (async () => {
      const sourceDate = chinaDate(now())
      if (chinaTime(now()) < '15:05:00') throw new Error('请在交易日 15:05 后准备下次竞价候选池，避免保存盘中涨停名单。')
      const reference = await getJson(auctionUrls('SH000001').quote, fetcher)
      if (reference.f57 !== '000001' || !positive(reference.f86) || chinaDate(reference.f86 * 1000) !== sourceDate || chinaTime(reference.f86 * 1000) < '15:00:00')
        throw new Error('尚未确认今日收盘行情，未准备候选池。')
      const pool = await getJson(`https://push2ex.eastmoney.com/getTopicZTPool?${new URLSearchParams({ ut: UT, dpt: 'wz.ztzt', Pageindex: '0', pagesize: '5000', sort: 'fbt:asc', date: String(dateNumber(sourceDate)) })}`, fetcher)
      if (Number(pool.qdate) !== dateNumber(sourceDate) || !Array.isArray(pool.pool) || Number(pool.tc) !== pool.pool.length)
        throw new Error('收盘涨停池日期不符或返回不完整，未覆盖已保存的候选池。')
      const seen = new Set()
      const stocks = pool.pool.map(row => ({ code: (row.m === 1 ? 'SH' : 'SZ') + row.c, name: row.n }))
        .filter(stock => {
          if (!validCode(stock.code) || typeof stock.name !== 'string' || !stock.name.trim() || seen.has(stock.code)) return false
          seen.add(stock.code)
          return true
        })
      if (!stocks.length || stocks.length > 500) throw new Error('收盘涨停池为空或超出 500 只上限，未覆盖已保存的候选池。')
      let previous = null
      try { previous = validateCandidates(await candidateStore.load(sourceDate), sourceDate) } catch {}
      const savedStocks = new Map(previous?.stocks.map(stock => [stock.code, stock]) ?? [])
      const rows = await mapLimit(stocks, 8, async stock => {
        let daily = candidateDaily(savedStocks.get(stock.code)?.daily, stock.code, sourceDate)
        if (!daily) {
          try { daily = candidateDaily(await getJson(auctionUrls(stock.code).daily, fetcher, { timeoutMs: 4000, attempts: 1 }), stock.code, sourceDate) } catch {}
        }
        return { ...stock, daily }
      })
      const bundle = { schemaVersion: 1, sourceDate, origin: 'closing', savedAt: new Date(now()).toISOString(), stocks: rows }
      await candidateStore.save(bundle)
      const dailyCount = rows.filter(stock => stock.daily).length
      return { sourceDate, stockCount: rows.length, dailyCount, savedAt: bundle.savedAt,
        message: `已保存 ${sourceDate} 收盘涨停股 ${rows.length} 只，${dailyCount} 只已备齐成交量；下一个交易日竞价直接扫描，缺失资料自动补取。` }
    })().finally(() => { inflight = null })
    return inflight
  }
}
