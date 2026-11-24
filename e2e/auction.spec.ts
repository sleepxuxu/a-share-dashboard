import { test, expect, type Page } from '@playwright/test'
import { auctionDemo, auctionTemplate } from '../src/lib/auction'
import { readFile } from 'node:fs/promises'

async function unavailableSource(page: Page) {
  await page.route('**/api/auction*', route => route.fulfill({ status: 502, json: { error: '受控测试：自动数据源暂不可用' } }))
}

test('09:25:05 自动强刷并保存窗口结束后的名单，显示实际采样秒数', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T09:24:00+08:00') })
  await page.clock.pauseAt(new Date('2026-11-18T09:25:04+08:00'))
  const requests: string[] = []
  await page.route('**/api/auction*', route => {
    const force = route.request().url().includes('refresh=1')
    requests.push(route.request().url())
    const asOf = `2026-11-18T09:25:0${force ? 5 : 4}+08:00`
    return route.fulfill({ json: {
      ...auctionDemo(), demo: undefined, source: '受控竞价数据',
      records: [{ ...auctionDemo().records[0], auctionTime: force ? '09:25:05' : '09:25:00' }],
      automatic: { fetchedAt: asOf, asOf, isToday: true, stale: false, poolCount: 1, scannedCount: 1, incompleteCount: 0, warnings: [] },
    } })
  })
  await page.goto('/auction')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  expect(await page.evaluate(() => localStorage.getItem('a-share-auction-selections-v1'))).toBeNull()
  await page.clock.runFor(999)
  expect(requests.filter(url => url.includes('refresh=1'))).toHaveLength(0)
  await page.clock.runFor(1)
  await expect(page.locator('.auction-table tbody')).toContainText('09:25:05')
  expect(requests.filter(url => url.includes('refresh=1'))).toHaveLength(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('a-share-auction-selections-v1'))).not.toBeNull()
})

test('竞价页面导航、演示、阈值重筛、缺失核验、导出与布局', async ({ page }, testInfo) => {
  await unavailableSource(page)
  await page.goto('/auction')
  await expect(page.getByRole('link', { name: '竞价选股', exact: true })).toHaveAttribute('aria-current', 'page')
  await expect(page.getByText('自动竞价数据暂不可用', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: '体验演示数据' }).click()
  await expect(page.getByText('演示模式 · 虚构数据')).toBeVisible()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: '核验示例甲（虚构）' }).click()
  await expect(page.getByRole('dialog')).toContainText('09:25:00 10.50 元 > 09:24:57 10.30 元')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '待核验' }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await page.getByRole('button', { name: '核验示例戊（虚构）' }).click()
  await expect(page.getByRole('dialog')).toContainText('缺数据')
  await page.keyboard.press('Escape')
  await page.getByLabel('竞价量占昨日成交量阈值').fill('5')
  await page.getByRole('button', { name: '应用条件' }).click()
  await page.getByRole('button', { name: '符合条件' }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '恢复默认' }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出入选' }).click()
  expect((await downloadEvent).suggestedFilename()).toContain('演示-竞价选股')
  await page.getByLabel('搜索竞价股票').fill('示例乙')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await page.getByLabel('搜索竞价股票').fill('')
  const layout = await page.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth,
    outside: [...document.querySelectorAll('body *')].filter(el => el.getBoundingClientRect().right > innerWidth).slice(0, 8).map(el => ({ className: el.className, right: el.getBoundingClientRect().right })) }))
  expect(layout.scrollWidth, JSON.stringify(layout)).toBeLessThanOrEqual(layout.width)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('auction.png'), fullPage: true, animations: 'disabled' })
  await page.reload()
  await expect(page.getByText('自动竞价数据暂不可用', { exact: true })).toBeVisible()
})

test('导入校验、预览与替换，模板空字段不会入选', async ({ page }) => {
  await unavailableSource(page)
  await page.goto('/auction')
  await page.getByRole('button', { name: '导入竞价快照', exact: true }).click()
  const dialog = page.getByRole('dialog')
  await dialog.getByLabel('JSON 快照内容').fill('invalid')
  await dialog.getByRole('button', { name: '校验并预览' }).click()
  await expect(dialog.getByRole('alert')).toContainText('JSON 格式无效')
  const dataset = { ...auctionDemo(), demo: undefined, source: '受控测试快照', records: [auctionDemo().records[0]] }
  await dialog.getByLabel('JSON 快照内容').fill(JSON.stringify(dataset))
  await dialog.getByRole('button', { name: '校验并预览' }).click()
  await expect(dialog).toContainText('已校验 1 条股票快照')
  await dialog.getByRole('button', { name: '确认导入 1 条' }).click()
  await expect(page.getByText('已导入竞价快照', { exact: true })).toBeVisible()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '导入竞价快照', exact: true }).click()
  await page.getByLabel('选择竞价 JSON 文件').setInputFiles({ name: 'template.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(auctionTemplate())) })
  await page.getByRole('button', { name: '校验并预览' }).click()
  await page.getByRole('button', { name: '确认导入 1 条' }).click()
  await expect(page.getByText('暂无股票同时满足全部条件')).toBeVisible()
  await page.getByRole('button', { name: '待核验' }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '清空快照' }).click()
  await expect(page.getByText('自动竞价数据暂不可用', { exact: true })).toBeVisible()
})

test('页面自动取数、秒级证据、刷新失败保留快照、切换演示与恢复自动', async ({ page }, testInfo) => {
  const record = { ...auctionDemo().records[0], name: '自动测试股票', previousLimitUpPrice: null, previousLimitUpVerified: true, dataWarnings: [] }
  const snapshot = { ...auctionTemplate(), source: '受控自动行情', records: [record], automatic: {
    fetchedAt: '2026-11-18T02:00:00Z', asOf: '2026-11-18T01:26:00Z', isToday: true, stale: false,
    poolCount: 1, scannedCount: 1, incompleteCount: 0, warnings: ['覆盖范围', '时点日期核验', '金额计算口径'],
  } }
  let fail = false
  const requested: string[] = []
  await page.route('**/api/auction*', route => { requested.push(route.request().url()); return route.fulfill(fail ? { status: 502, json: { error: '受控刷新失败' } } : { json: snapshot }) })
  await page.goto('/auction')
  await expect(page.getByText('自动竞价快照', { exact: true })).toBeVisible()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '核验自动测试股票' }).click()
  await expect(page.getByRole('dialog')).toContainText('前一交易日涨停池确认')
  await expect(page.getByRole('dialog')).toContainText('09:24:57 10.30 元')
  await page.keyboard.press('Escape')
  fail = true
  await page.getByRole('button', { name: '刷新竞价', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('受控刷新失败')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  expect(requested.at(-1)).toContain('refresh=1')
  fail = false
  await page.getByRole('button', { name: '重试', exact: true }).click()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: testInfo.outputPath('auction-automatic.png'), fullPage: true, animations: 'disabled' })
  await page.getByRole('button', { name: '清空快照' }).click()
  await page.getByRole('button', { name: '体验演示数据' }).click()
  await expect(page.getByText('演示模式 · 虚构数据')).toBeVisible()
  await page.getByRole('button', { name: '刷新竞价', exact: true }).click()
  await expect(page.getByText('自动竞价快照', { exact: true })).toBeVisible()
})

test('新增过滤排除创业板/ST和竞价负涨幅，平开保留且导出一致', async ({ page }) => {
  const base = auctionDemo().records[0]
  const records = [
    { ...base, name: '主板合格' },
    { ...base, code: 'SZ000002', name: '平开合格', price092457: 9.99, price092500: 10 },
    { ...base, code: 'SZ300001', name: '创业板三百' },
    { ...base, code: 'SZ301001', name: '创业板三零一' },
    { ...base, code: 'SZ000004', name: '*ST测试' },
    { ...base, code: 'SZ000005', name: '低开测试', price092457: 9.98, price092500: 9.99 },
  ]
  await page.route('**/api/auction*', route => route.fulfill({ json: {
    ...auctionTemplate(), records, source: '新增条件受控行情', automatic: {
      fetchedAt: '2026-11-18T02:00:00Z', asOf: '2026-11-18T02:00:00Z', isToday: true, stale: false,
      poolCount: 6, scannedCount: 6, incompleteCount: 0, warnings: [],
    },
  } }))
  await page.goto('/auction')
  await expect(page.getByLabel('固定附加条件')).toContainText('排除创业板与 ST')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.auction-table tbody')).toContainText('主板合格')
  await expect(page.locator('.auction-table tbody')).toContainText('平开合格')
  await expect(page.locator('.auction-table tbody')).toContainText('0.00%')
  await expect(page.locator('.auction-funnel > div').last()).toContainText('附加过滤2')
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出入选' }).click()
  const download = await downloadEvent
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.records.map((record: { code: string }) => record.code)).toEqual(['SZ000001', 'SZ000002'])
  expect(exported.appliedRules).toMatchObject({ excludeChiNext: true, excludeST: true, minimumAuctionChangePercent: 0 })
  await page.getByRole('button', { name: '未通过' }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(4)
  await page.getByRole('button', { name: '核验创业板三零一' }).click()
  await expect(page.getByRole('dialog')).toContainText('排除：创业板股票（SZ301001）')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '核验*ST测试' }).click()
  await expect(page.getByRole('dialog')).toContainText('ST 风险警示股票')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '核验低开测试' }).click()
  await expect(page.getByRole('dialog')).toContainText('竞价涨幅 -0.10%')
  await page.keyboard.press('Escape')
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true)
})
