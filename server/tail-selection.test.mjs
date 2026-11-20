import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createTailSelectionService, tailChecks } from './tail-selection.mjs'
import { createFetchHandler } from './fetch-handler.mjs'

const timestamp = Date.parse('2026-11-20T06:52:00Z')
const raw = (code, extra = {}) => ({ f12: code, f13: 0, f14: '测试股票', f2: 20, f3: 4, f6: 5e8, f7: 5, f8: 6, f10: 2, f15: 21, f16: 19, f18: 19.23, f21: 100e8, f124: timestamp / 1000, ...extra })

test('四项数值含边界，缺失及非有限值不通过；使用流通市值口径', () => {
  assert.deepEqual(tailChecks({ change: 3, volumeRatio: 1, turnover: 5, floatCap: 50e8 }), [true, true, true, true])
  assert.deepEqual(tailChecks({ change: 5, volumeRatio: 2, turnover: 10, floatCap: 200e8 }), [true, true, true, true])
  assert.deepEqual(tailChecks({ change: 5.01, volumeRatio: .99, turnover: 10.01, floatCap: 200e8 + 1 }), [false, false, false, false])
  assert.deepEqual(tailChecks({ change: null, volumeRatio: NaN, turnover: '-', marketCap: 100e8 }), [null, null, null, null])
})

test('扫描未预筛的涨幅排行，漏斗包含未通过和缺失证据，排除ST及无日期记录', async () => {
  const fetcher = async url => new Response(JSON.stringify({ data: { total: 8, diff: url.includes('ulist') ? [] : [
    raw('002001'), raw('002002', { f21: '-' }), raw('002003', { f14: '*ST测试' }), raw('002004', { f8: 11 }),
    raw('002005', { f10: .5 }), raw('002006', { f3: 6 }), raw('002007', { f124: '-' }), raw('002008', { f124: (timestamp - 86400000) / 1000 }),
  ] } }))
  const result = await createTailSelectionService(fetcher, () => timestamp + 1000)()
  assert.deepEqual(result.stages, [5, 4, 3, 2, 1])
  assert.equal(result.candidates[0].code, 'SZ002001')
  assert.equal(result.candidates[0].floatCap, 100e8)
  assert.equal(result.candidates.find(stock => stock.code === 'SZ002002').gates[3], null)
  assert.equal(result.isToday, true); assert.equal(result.stale, false)
  assert.equal(result.candidates.some(stock => stock.code === 'SZ002003'), false)
})

test('合并并发与缓存，源失败保留旧结果且明确过期', async () => {
  let calls = 0, fail = false
  const fetcher = async url => {
    calls++; if (fail) throw new Error('offline')
    return new Response(JSON.stringify({ data: { total: 1, diff: url.includes('ulist') ? [] : [raw('002001')] } }))
  }
  const service = createTailSelectionService(fetcher, () => timestamp)
  const [a, b] = await Promise.all([service(), service()])
  assert.deepEqual(a, b); assert.equal(calls, 2)
  await service(); assert.equal(calls, 2)
  fail = true
  const old = await service(true)
  assert.equal(old.stale, true); assert.equal(old.asOf, a.asOf)
  assert.ok(old.warnings.some(message => message.includes('刷新失败')))
})

test('分页中途失败和重复页只披露局部覆盖，不宣称完整结果', async () => {
  let page = 0
  const fetcher = async url => {
    if (url.includes('ulist')) return new Response(JSON.stringify({ data: { diff: [] } }))
    page++
    if (page === 2) throw new Error('offline')
    return new Response(JSON.stringify({ data: { total: 5000, diff: [raw('002001')] } }))
  }
  const result = await createTailSelectionService(fetcher, () => timestamp)()
  assert.equal(result.scannedCount, 1)
  assert.ok(result.warnings.some(message => message.includes('不完整')))
  assert.ok(result.warnings.some(message => message.includes('未扫描不等于未通过')))
})

test('历史和未来时点都不标记为当前有效快照', async () => {
  const fetcher = async url => new Response(JSON.stringify({ data: { total: 1, diff: url.includes('ulist') ? [] : [raw('002001')] } }))
  const historical = await createTailSelectionService(fetcher, () => timestamp + 86400000)()
  assert.equal(historical.isToday, false); assert.equal(historical.stale, true)
  const future = await createTailSelectionService(fetcher, () => timestamp - 120000)()
  assert.equal(future.stale, true)
})

test('Node与Worker共享选股接口，转发强刷并保留跨站校验', async () => {
  let force = false, market
  const handler = createFetchHandler({ getTailSelection: async (value, scope) => { force = value; market = scope; return { stages: [10, 8, 6, 4, 2] } } })
  const response = await handler(new Request('http://local/api/tail-selection?refresh=1'), {})
  assert.equal(response.status, 200); assert.equal(force, true); assert.equal(market, 'main')
  assert.deepEqual(await response.json(), { stages: [10, 8, 6, 4, 2] })
  const blocked = await handler(new Request('http://local/api/tail-selection', { headers: { origin: 'https://other.example' } }), {})
  assert.equal(blocked.status, 403)
  await handler(new Request('http://local/api/tail-selection?market=all'), {})
  assert.equal(market, 'all')
  assert.equal((await handler(new Request('http://local/api/tail-selection?market=unknown'), {})).status, 400)
})

test('默认主板从数据源与代码双重排除创业板、科创板，全部范围缓存独立', async () => {
  const scopes = []
  const fetcher = async url => {
    const isIndex = url.includes('ulist')
    if (!isIndex) scopes.push(new URL(url).searchParams.get('fs'))
    return new Response(JSON.stringify({ data: { total: 7, diff: isIndex ? [] : [
      raw('002001'), raw('001001'), raw('600001', { f13: 1 }), raw('605001', { f13: 1 }),
      raw('300001'), raw('301001'), raw('688001', { f13: 1 }),
    ] } }))
  }
  const service = createTailSelectionService(fetcher, () => timestamp)
  const [main, all] = await Promise.all([service(), service(false, 'all')])
  assert.equal(main.market, 'main'); assert.equal(main.candidates.length, 4)
  assert.ok(main.candidates.every(stock => /^(SH60\d{4}|SZ00\d{4})$/.test(stock.code)))
  assert.equal(all.market, 'all'); assert.equal(all.candidates.length, 7)
  assert.ok(scopes.includes('m:0+t:6,m:1+t:2'))
  assert.ok(scopes.some(scope => scope.includes('t:80') && scope.includes('t:23')))
  assert.deepEqual(await service(), main); assert.deepEqual(await service(false, 'all'), all)
  assert.equal(scopes.length, 2)
})
