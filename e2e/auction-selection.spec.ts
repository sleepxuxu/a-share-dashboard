import { test, expect, type Page } from '@playwright/test'
import { auctionDemo, DEFAULT_AUCTION_RULES } from '../src/lib/auction'
import type { SelectionPerformance } from '../src/lib/auctionSelections'

const key = 'a-share-auction-selections-v1'
const calendar = { startDate: '2025-11-18', endDate: '2026-11-17', previousTradeDate: '2025-11-17', sessions: ['2026-11-16', '2026-11-17'], missing: [], explanation: '', fetchedAt: '', source: 'test' }
function snapshot(asOf = '2026-11-18T02:00:00Z') {
  return { ...auctionDemo(), demo: undefined, source: '受控竞价数据', records: [{ ...auctionDemo().records[0], code: 'SZ002843', name: '泰嘉股份', limitUpPrice: 17.34, price091500: 17.34 }], automatic: { fetchedAt: asOf, asOf, isToday: true, stale: false, poolCount: 1, scannedCount: 1, incompleteCount: 0, warnings: [] } }
}
const waiting: SelectionPerformance = { code: 'SZ002843', tradeDate: '2026-11-18', status: 'waiting_exit', entry: { date: '2026-11-18', time: '09:30:00', price: 16.77, volume: 1350450 }, exit: null, nextTradeDate: null, latest: { date: '2026-11-18', price: 15.52, final: false }, warnings: ['次一交易日尚未收盘'], fetchedAt: '', source: '受控分笔及日线' }
async function coverage(page: Page) {
  await page.route('**/api/auction/backtest/coverage*', route => route.fulfill({ json: calendar }))
}
test('竞价入选自动存档，一键查看后续真实时点字段，待次日收盘显示浮盈亏', async ({ page }, testInfo) => {
  await page.route('**/api/auction', route => route.fulfill({ json: snapshot() }))
  await coverage(page)
  const requests: string[] = []
  await page.route('**/api/auction/performance?*', route => { requests.push(route.request().url()); return route.fulfill({ json: waiting }) })
  await page.goto('/auction')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await expect.poll(() => page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || '{}').days?.length, key)).toBe(1)
  await page.getByRole('link', { name: '回测入选股票' }).click()
  const row = page.locator('.backtest-trades tbody tr')
  await expect(row).toHaveCount(1)
  await expect(row).toContainText('泰嘉股份')
  await expect(row).toContainText('16.77')
  await expect(row).toContainText('09:30:00')
  await expect(row).toContainText('等待次日收盘')
  await expect(row).toContainText('-132.02')
  await expect(row).toContainText('浮盈亏，未计卖出费用')
  expect(requests.some(url => url.includes('code=SZ002843') && url.includes('date=2026-11-18'))).toBe(true)
  await expect(page.getByLabel('入选后表现统计')).toContainText('待完整记录')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '备份名单' }).click()
  expect((await downloadEvent).suggestedFilename()).toBe('竞价历史入选名单.json')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('selection-performance.png'), fullPage: true, animations: 'disabled' })
  await page.reload()
  await expect(row).toContainText('泰嘉股份')
  expect(await page.evaluate(storageKey => JSON.parse(localStorage.getItem(storageKey) || '{}').days.length, key)).toBe(1)
})
test('导入仅代码名称的历史入选名单自动补行情，不要求原竞价字段，缺失不冒充零收益', async ({ page }) => {
  await page.route('**/api/auction', route => route.fulfill({ status: 503, json: { error: '受控最新名单暂不可用' } }))
  await coverage(page)
  await page.route('**/api/auction/performance?*', route => {
    const code = new URL(route.request().url()).searchParams.get('code')
    return route.fulfill({ json: code === 'SZ002843' ? { ...waiting, tradeDate: '2026-11-16', status: 'complete', entry: { date: '2026-11-16', time: '09:30:00', price: 10.5, volume: 10000 }, exit: { date: '2026-11-17', price: 11 }, nextTradeDate: '2026-11-17' } : { ...waiting, code, tradeDate: '2026-11-16', status: 'missing', entry: null, exit: null, warnings: ['没有取得历史成交分笔'] } })
  })
  await page.goto('/auction/backtest')
  await expect(page.getByRole('alert')).toContainText('受控最新名单暂不可用')
  const archive = { schemaVersion: 1, kind: 'auction-selections', days: [{ tradeDate: '2026-11-16', source: '真实历史入选名单测试', complete: true, rules: DEFAULT_AUCTION_RULES, stocks: [{ code: '002843', name: '样本甲' }, { code: '600000', name: '样本乙' }] }] }
  await page.getByLabel('历史入选名单文件').setInputFiles({ name: 'signals.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)) })
  await expect(page.locator('.backtest-trades tbody tr')).toHaveCount(2)
  await expect(page.locator('.backtest-trades tbody')).toContainText('35.43')
  await expect(page.locator('.backtest-trades tbody')).toContainText('没有取得历史成交分笔')
  await expect(page.getByLabel('入选后表现统计')).toContainText('35.43 元')
  await expect(page.getByLabel('入选后表现统计')).toContainText('已完成价格测算1 笔')
  await expect(page.getByText('一年历史完整名单覆盖 1 / 2 日', { exact: false })).toBeVisible()
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出后续表现' }).click()
  expect((await event).suggestedFilename()).toContain('竞价入选后价格与盈亏')
})
test('09:25前快照及演示名单不写入真实历史名单', async ({ page }) => {
  await page.route('**/api/auction', route => route.fulfill({ json: snapshot('2026-11-18T01:24:00Z') }))
  await coverage(page)
  await page.goto('/auction/backtest')
  await expect(page.getByText('最终竞价尚未形成或快照过期', { exact: false })).toBeVisible()
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBeNull()
  await page.getByLabel('历史入选名单文件').setInputFiles({ name: 'demo.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify({ ...auctionDemo(), appliedRules: DEFAULT_AUCTION_RULES })) })
  await expect(page.getByRole('alert')).toContainText('演示名单不能用于真实行情回测')
  expect(await page.evaluate(storageKey => localStorage.getItem(storageKey), key)).toBeNull()
})
