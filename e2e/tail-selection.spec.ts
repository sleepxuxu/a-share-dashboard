import { test, expect } from '@playwright/test'
import { makeTailDemo, tailReviews } from '../src/lib/tailSelection'

test('默认只选主板，切换全部范围后标识创业板和科创板并清除旧复核', async ({ page }) => {
  const observedScopes: string[] = []
  await page.route('**/api/tail-selection*', route => {
    const market = new URL(route.request().url()).searchParams.get('market') === 'all' ? 'all' : 'main'
    observedScopes.push(market)
    const fixture = { ...makeTailDemo(market), demo: false, warnings: [] }
    if (market === 'all') {
      fixture.candidates[1] = { ...fixture.candidates[1], code: 'SZ300001', name: '创业板样例' }
      fixture.candidates[2] = { ...fixture.candidates[2], code: 'SH688001', name: '科创板样例' }
    }
    return route.fulfill({ json: fixture })
  })
  await page.goto('/tail-selection')
  await expect(page.getByLabel('选股市场范围', { exact: true })).toHaveValue('main')
  await expect(page.locator('.tail-stock-card .tail-board-label')).toHaveText(['主板', '主板', '主板'])
  await page.getByLabel('成交量温和放大', { exact: true }).selectOption('pass')
  await page.getByLabel('选股市场范围', { exact: true }).selectOption('all')
  await expect(page.locator('.tail-stock-card .tail-board-label')).toHaveText(['主板', '创业板', '科创板'])
  await expect(page.getByLabel('成交量温和放大', { exact: true })).toHaveValue('pending')
  await page.getByLabel('选股市场范围', { exact: true }).selectOption('main')
  await expect(page.locator('.tail-stock-card .tail-board-label')).toHaveText(['主板', '主板', '主板'])
  // StrictMode may repeat the initial effect; assert scope transitions, not request count.
  expect(observedScopes.filter((scope, index) => index === 0 || scope !== observedScopes[index - 1])).toEqual(['main', 'all', 'main'])
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('新增导航在各屏幕断点保持可见，页面不横向溢出', async ({ page }, info) => {
  test.skip(info.project.name !== 'desktop', '断点矩阵在桌面浏览器运行一次')
  await page.route('**/api/tail-selection*', route => route.fulfill({ json: makeTailDemo() }))
  await page.goto('/tail-selection')
  await expect(page.locator('.tail-stock-card')).toHaveCount(3)
  for (const width of [360, 390, 620, 621, 768, 900, 1024, 1440]) {
    await page.setViewportSize({ width, height: 900 })
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `viewport ${width}`).toBe(true)
  }
})

test('尾盘初筛、独立观察、人工复核和刷新重置', async ({ page }) => {
  const fixture = { ...makeTailDemo(), demo: false, warnings: [] }
  await page.route('**/api/tail-selection*', route => route.fulfill({ json: fixture }))
  await page.goto('/tail-selection')
  await expect(page.getByRole('heading', { name: '把筛选，留给尾盘.' })).toBeVisible()
  await expect(page.locator('.tail-stock-card')).toHaveCount(3)
  await page.getByRole('button', { name: '加入观察示例智造', exact: true }).click()
  await expect(page.getByRole('button', { name: '移出观察示例智造', exact: true })).toBeVisible()
  await page.getByRole('button', { name: '已观察 1', exact: true }).click()
  await expect(page.locator('.tail-stock-card')).toHaveCount(1)
  await page.getByLabel('成交量温和放大', { exact: true }).selectOption('fail')
  await expect(page.getByText('存在未通过项', { exact: true })).toBeVisible()
  for (const item of tailReviews) await page.getByLabel(item.title, { exact: true }).selectOption('pass')
  await expect(page.getByText('人工复核已完成', { exact: true })).toBeVisible()
  await expect(page.getByText('当前为演示、历史或延迟数据，仅用于复盘。', { exact: false })).toBeVisible()
  await page.getByRole('button', { name: '刷新筛选', exact: true }).click()
  await expect(page.getByLabel('成交量温和放大', { exact: true })).toHaveValue('pending')
  await page.getByRole('button', { name: '涨幅初筛 8', exact: true }).click()
  await page.getByLabel('搜索尾盘候选').fill('示例装备')
  await expect(page.locator('.tail-stock-card')).toHaveCount(1)
  await expect(page.locator('.tail-stock-card')).toContainText('1/4 数值条件')
  await expect(page.getByText('数值条件未全部满足', { exact: true })).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})

test('失败可恢复、演示隔离、导出标识与策略说明', async ({ page }) => {
  let fail = true
  await page.route('**/api/tail-selection*', route => route.fulfill(fail ? { status: 502, json: { error: '行情源读取失败' } } : { json: { ...makeTailDemo(), demo: false } }))
  await page.goto('/tail-selection')
  await expect(page.getByRole('alert')).toContainText('行情源读取失败')
  await page.getByRole('button', { name: '体验演示', exact: true }).first().click()
  await expect(page.getByText('演示模式', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: '加入观察示例智造', exact: true })).toBeDisabled()
  await expect(page.getByRole('button', { name: 'Skill 研究', exact: false })).toBeDisabled()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出快照' }).click()
  expect((await downloadEvent).suggestedFilename()).toContain('演示-')
  await page.getByRole('button', { name: '策略说明', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('原文存在的口径冲突')
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.screenshot({ path: `test-results/tail-selection-${test.info().project.name}.png`, fullPage: true })
  fail = false
  await page.getByRole('button', { name: '返回真实行情', exact: false }).click()
  await expect(page.getByText('演示模式', { exact: true })).toHaveCount(0)
  await expect(page.locator('.tail-stock-card')).toHaveCount(3)
})
