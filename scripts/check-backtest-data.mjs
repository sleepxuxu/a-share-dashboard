import { mkdir, writeFile } from 'node:fs/promises'
import { createAuctionBacktestCoverage } from '../server/auction-backtest.mjs'
import { auctionUrls } from '../server/auction.mjs'

const calendar = await createAuctionBacktestCoverage()()
const code = 'SZ002843', ticksUrl = auctionUrls(code).ticks
const probes = await Promise.all([calendar.startDate, calendar.sessions.at(-20)].map(async date => {
  const response = await fetch(`${ticksUrl}&date=${date.replaceAll('-', '')}`, { signal: AbortSignal.timeout(15000) })
  if (!response.ok) throw new Error(`快照核验失败：${response.status}`)
  const raw = await response.json(), data = raw.data
  return { requestedDate: date, code: data?.code, prePrice: data?.prePrice, dateFields: Object.keys(data ?? {}).filter(key => /date/i.test(key)), auction: data?.details?.filter(line => /^(09:15:00|09:24:57|09:25:00),/.test(line)) ?? [], raw }
}))
const sinaDate = calendar.endDate
const sinaUrl = `https://vip.stock.finance.sina.com.cn/quotes_service/api/json_v2.php/CN_Bill.GetBillList?symbol=sz002843&num=60&page=1&sort=ticktime&asc=1&volume=0&amount=0&type=0&day=${sinaDate}`
let sina
try {
  const response = await fetch(sinaUrl, { signal: AbortSignal.timeout(15000), headers: { Referer: 'https://vip.stock.finance.sina.com.cn/quotes_service/view/cn_bill.php?symbol=sz002843', 'User-Agent': 'Mozilla/5.0' } })
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const raw = await response.json()
  sina = { date: sinaDate, firstTimes: Array.isArray(raw) ? raw.slice(0, 3).map(row => row.ticktime) : [], hasIndicativePreAuction: Array.isArray(raw) && raw.some(row => row.ticktime < '09:25:00'), raw }
} catch (error) { sina = { date: sinaDate, error: error.message } }
const sameAuction = probes.every(probe => probe.auction.length === 3) && JSON.stringify(probes[0].auction) === JSON.stringify(probes[1].auction) && probes[0].prePrice === probes[1].prePrice
const report = { checkedAt: new Date().toISOString(), calendar, probes, sameAuctionDespiteDifferentDates: sameAuction, sina, conclusion: '当前接口不能作为原策略一年历史竞价数据源；不能依据相同的最新快照构造历史信号。' }
await mkdir('test-results', { recursive: true })
await writeFile('test-results/backtest-data-check.json', JSON.stringify(report, null, 2))
console.log(JSON.stringify({ sessions: calendar.sessions.length, start: calendar.startDate, end: calendar.endDate, probes: probes.map(({ raw, ...summary }) => summary), sameAuction, sina: { date: sina.date, firstTimes: sina.firstTimes, hasIndicativePreAuction: sina.hasIndicativePreAuction, error: sina.error }, evidence: 'test-results/backtest-data-check.json' }, null, 2))
