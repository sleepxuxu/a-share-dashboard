import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createAuctionBacktestCoverage } from './auction-backtest.mjs'
import { createFetchHandler } from './fetch-handler.mjs'

const now = () => Date.parse('2026-11-18T03:00:00Z')
function lines() {
  return Array.from({ length: 400 }, (_, index) => {
    const date = new Date('2025-10-15T00:00:00Z'); date.setUTCDate(date.getUTCDate() + index)
    return date
  }).filter(date => date.getUTCDay() !== 0 && date.getUTCDay() !== 6).map(date => date.toISOString().slice(0, 10) + ',1,1,1,1,1,1')
}
test('近一年日历排除今日，保留前一交易日且合并缓存，不虚构历史竞价覆盖', async () => {
  let calls = 0
  const service = createAuctionBacktestCoverage(async url => {
    calls++; assert.equal(new URL(url).searchParams.get('end'), '20261117')
    return Response.json({ data: { code: '000001', klines: lines() } })
  }, now)
  const [a, b] = await Promise.all([service(), service()])
  assert.deepEqual(a, b); assert.equal(calls, 1)
  assert.equal(a.startDate, '2025-11-18'); assert.equal(a.endDate, '2026-11-17')
  assert.equal(a.previousTradeDate, '2025-11-17'); assert.equal(a.historicalAuctionAvailable, false)
  assert.ok(a.sessions.every(date => date < '2026-11-18'))
  await service(); assert.equal(calls, 1)
  await service(true); assert.equal(calls, 2)
})
test('日历不完整、过期或格式不对时不返回伪覆盖率', async () => {
  for (const data of [{ code: '000001', klines: [] }, { code: 'bad', klines: lines() }, { code: '000001', klines: lines().slice(0, 220) }]) {
    await assert.rejects(createAuctionBacktestCoverage(async () => Response.json({ data }), now)())
  }
})
test('回测覆盖接口经共享 Fetch adapter 返回并拒绝跨站请求', async () => {
  const handler = createFetchHandler({ getAuctionBacktestCoverage: async force => ({ sessions: ['2026-11-17'], force, historicalAuctionAvailable: false }) })
  const response = await handler(new Request('https://example.com/api/auction/backtest/coverage?refresh=1'), {})
  assert.equal(response.status, 200); assert.equal((await response.json()).force, true)
  const denied = await handler(new Request('https://example.com/api/auction/backtest/coverage', { headers: { Origin: 'https://other.com' } }), {})
  assert.equal(denied.status, 403)
})
