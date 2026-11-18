import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuctionPerformance } from './auction-performance.mjs'
import { createFetchHandler } from './fetch-handler.mjs'

const calendar = ['2026-11-16,1,1,1,1,1,1', '2026-11-17,1,1,1,1,1,1', '2026-11-18,1,1,1,1,1,1']
const daily = ['2026-11-17,14.97,15.76,16,14,1,1', '2026-11-18,16.39,15.52,17,15,1,1']
const ticks = [{ symbol: 'sz002843', ticktime: '09:25:00', price: '14.97', volume: '701500' }, { symbol: 'sz002843', ticktime: '09:30:00', price: '14.85', volume: '956000' }]
function fetcher({ rows = ticks, stock = daily } = {}) {
  return async url => {
    const parsed = new URL(url)
    if (url.includes('GetBillList')) {
      assert.equal(parsed.searchParams.get('day'), '2026-11-17'); assert.equal(parsed.searchParams.get('asc'), '1')
      return Response.json(rows)
    }
    const index = parsed.searchParams.get('secid') === '1.000001'
    return Response.json({ data: { code: index ? '000001' : '002843', klines: index ? calendar : stock } })
  }
}
test('已入选股票仅需日期代码，自动取得0930首笔和下一交易日收盘，合并缓存', async () => {
  let calls = 0, base = fetcher()
  const service = createAuctionPerformance(async (...args) => { calls++; return base(...args) }, () => Date.parse('2026-11-18T08:00:00Z'))
  const [a, b] = await Promise.all([service('SZ002843', '2026-11-17'), service('SZ002843', '2026-11-17')])
  assert.deepEqual(a, b); assert.equal(calls, 3)
  assert.equal(a.status, 'complete'); assert.equal(a.entry.price, 14.85); assert.equal(a.entry.time, '09:30:00'); assert.equal(a.entry.volume, 956000)
  assert.deepEqual(a.exit, { date: '2026-11-18', price: 15.52 })
  await service('SZ002843', '2026-11-17'); assert.equal(calls, 3)
})
test('下一交易日盘中不提前使用当日日线收盘列作为卖出价', async () => {
  const result = await createAuctionPerformance(fetcher(), () => Date.parse('2026-11-18T03:00:00Z'))('SZ002843', '2026-11-17')
  assert.equal(result.status, 'waiting_exit'); assert.equal(result.exit, null)
  assert.equal(result.latest.final, false); assert.equal(result.entry.price, 14.85)
})
test('历史分笔缺失、日期交叉核验不符、排序不对时不拿日线开盘补买价', async () => {
  for (const rows of [[], [{ ...ticks[0], price: 99 }, ticks[1]], [ticks[1], ticks[0]], [{ ...ticks[0], symbol: 'sz000001' }]]) {
    const result = await createAuctionPerformance(fetcher({ rows }), () => Date.parse('2026-11-18T08:00:00Z'))('SZ002843', '2026-11-17')
    assert.equal(result.status, 'missing'); assert.equal(result.entry, null); assert.ok(result.warnings.length)
  }
})
test('次日无个股日线保留缺口，未来日线不冒充次日', async () => {
  const result = await createAuctionPerformance(fetcher({ stock: [daily[0], '2026-11-19,17,18,19,16,1,1'] }), () => Date.parse('2026-11-18T08:00:00Z'))('SZ002843', '2026-11-17')
  assert.equal(result.status, 'missing'); assert.equal(result.exit, null)
  assert.equal(result.latest.date, '2026-11-17')
})
test('入选表现API校验参数、沿用跨站限制，并转发refresh', async () => {
  const handler = createFetchHandler({ getAuctionPerformance: async (code, date, force) => ({ code, date, force }) })
  const response = await handler(new Request('https://example.com/api/auction/performance?code=SZ002843&date=2026-11-17&refresh=1'), {})
  assert.deepEqual(await response.json(), { code: 'SZ002843', date: '2026-11-17', force: true })
  assert.equal((await handler(new Request('https://example.com/api/auction/performance?code=BAD&date=x'), {})).status, 400)
  assert.equal((await handler(new Request('https://example.com/api/auction/performance?code=SZ002843&date=2026-11-17', { headers: { Origin: 'https://other.com' } }), {})).status, 403)
  const service = createAuctionPerformance(fetcher(), () => Date.parse('2026-11-18T08:00:00Z'))
  await assert.rejects(service('SZ002843', '2026-11-19'))
  await assert.rejects(service('SZ002843', '2026-02-30'))
})
