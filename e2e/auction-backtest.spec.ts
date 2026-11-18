import { test, expect, type Page } from '@playwright/test'
import { auctionDemo } from '../src/lib/auction'
import { backtestTemplate } from '../src/lib/auctionBacktest'
import type { BacktestArchive, BacktestCoverage } from '../src/types/auctionBacktest'

const dates = ['2026-11-12', '2026-11-13', '2026-11-16']
const calendar: BacktestCoverage = { startDate: dates[0], endDate: dates[2], previousTradeDate: '2026-11-11', sessions: dates, fetchedAt: '2026-11-18T03:00:00Z', source: '受控测试日历', historicalAuctionAvailable: false, missing: ['09:15:00、09:24:57、09:25:00 历史竞价快照'], explanation: '当前竞价接口只返回最新交易日；历史日期参数不能取得历史快照。' }
const record = { ...auctionDemo().records[0], limitUpPrice: 12, price091500: 12 }
function archive(): BacktestArchive {
  return { schemaVersion: 1, kind: 'auction-backtest', demo: true, source: '受控虚构数据', scope: '受控测试完整池', days: dates.map((date, index) => ({ date, previousTradeDate: dates[index - 1] ?? '2026-11-11', poolComplete: true, historicalNames: true, candidates: index ? [] : [record], bars: [{ code: record.code, close: index === 1 ? 11 : 10.5, limitUp: 12, limitDown: 9, suspended: false, corporateAction: false, firstTrade: { time: '09:30:00', price: 10.5, volume: 1_000_000 } }] })) }
}
async function mockCoverage(page: Page) {
  await page.route('**/api/auction/backtest/coverage*', route => route.fulfill({ json: calendar }))
}
async function upload(page: Page, data: unknown) {
  await page.getByLabel('历史档案文件').setInputFiles({ name: 'history.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(data)) })
}
test('回测默认显示数据缺口，不显示伪造收益；模板不会产生零收益报告', async ({ page }, testInfo) => {
  await mockCoverage(page)
  await page.goto('/auction/strategy-backtest')
  await expect(page.getByText('当前自动源缺少一年历史竞价快照')).toBeVisible()
  await expect(page.getByRole('button', { name: '运行一年回测' })).toBeDisabled()
  await expect(page.getByRole('button', { name: '导出报告' })).toBeDisabled()
  await expect(page.getByLabel('回测统计')).not.toContainText('0.00%')
  await upload(page, backtestTemplate(calendar))
  await page.getByRole('button', { name: '运行一年回测' }).click()
  await expect(page.getByRole('alert')).toContainText('数据不完整，未生成年度收益')
  await expect(page.getByRole('button', { name: '导出报告' })).toBeDisabled()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('auction-backtest-missing.png'), fullPage: true, animations: 'disabled' })
})
test('完整档案回放扣费盈亏、曲线和明细，改参数使旧结果失效', async ({ page }, testInfo) => {
  await mockCoverage(page)
  await page.goto('/auction/strategy-backtest')
  await page.getByLabel('初始本金', { exact: true }).fill('100000')
  await upload(page, archive())
  await page.getByRole('button', { name: '运行一年回测' }).click()
  await expect(page.getByLabel('回测统计')).toContainText('2,109.93 元')
  await expect(page.getByRole('img', { name: '回测每日收盘总资产曲线' })).toBeVisible()
  await expect(page.getByRole('img', { name: '回测每日收盘回撤曲线' })).toBeVisible()
  await expect(page.locator('.backtest-trades tbody')).toContainText('2026-11-13')
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出报告' }).click()
  expect((await event).suggestedFilename()).toContain('演示-')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('auction-backtest-result.png'), fullPage: true, animations: 'disabled' })
  await page.getByLabel('单边滑点', { exact: true }).fill('0')
  await expect(page.getByRole('button', { name: '导出报告' })).toBeDisabled()
  await page.reload()
  await expect(page.getByRole('button', { name: '运行一年回测' })).toBeDisabled()
})
test('读取日历失败、导入单日快照与缺失交易日均明确提示', async ({ page }) => {
  await page.route('**/api/auction/backtest/coverage*', route => route.fulfill({ status: 502, json: { error: '日历接口受控失败' } }))
  await page.goto('/auction/strategy-backtest')
  await expect(page.getByRole('alert')).toContainText('日历接口受控失败')
  await mockCoverage(page)
  await page.getByRole('button', { name: '重新检查数据' }).click()
  await expect(page.getByText('3 个交易日', { exact: false })).toBeVisible()
  await upload(page, auctionDemo())
  await expect(page.getByRole('alert')).toContainText('不能直接导入单日竞价快照')
  const data = archive(); data.days.pop()
  await upload(page, data)
  await page.getByRole('button', { name: '运行一年回测' }).click()
  await expect(page.getByRole('alert')).toContainText('2026-11-16 缺少历史竞价档案')
})

