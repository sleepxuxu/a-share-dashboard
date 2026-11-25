import { test, expect, type Page } from '@playwright/test'
import { auctionDemo, auctionTemplate } from '../src/lib/auction'

test('竞价额1000万元门槛独立生效，低成交量可保留，边界、缺额、核验和导出一致', async ({ page }) => {
  const base = auctionDemo().records[0]
  const records = [
    { ...base, code: 'SZ000001', name: '少一元排除', auctionAmount: 9_999_999 },
    { ...base, code: 'SH600000', name: '恰好1000万', auctionAmount: 10_000_000 },
    { ...base, code: 'SZ000002', name: '超过1000万', auctionAmount: 10_000_001 },
    { ...base, code: 'SZ000003', name: '缺额待核验', auctionAmount: null },
  ]
  await page.route('**/api/auction*', route => route.fulfill({ json: {
    ...auctionTemplate(), records, source: '最低额受控测试', automatic: {
      fetchedAt: '2026-11-18T02:00:00Z', asOf: '2026-11-18T02:00:00Z', isToday: false, stale: false,
      poolCount: 4, scannedCount: 4, incompleteCount: 1, warnings: [],
    },
  } }))
  await page.goto('/auction')
  await expect(page.getByLabel('固定附加条件')).toContainText('竞价成交额 ≥ 1000 万元')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.auction-table tbody')).toContainText('0.1000')
  await page.getByRole('button', { name: '核验恰好1000万', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('10,000,000 元')
  await page.keyboard.press('Escape')
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出入选', exact: true }).click()
  const download = await event
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.records.map((record: { name: string }) => record.name)).toEqual(['恰好1000万', '超过1000万'])
  expect(exported.appliedRules.minimumAuctionAmount).toBe(10_000_000)
  expect(exported.appliedRules.minimumAuctionVolume).toBeUndefined()
  expect(exported.records.every((record: { auctionVolume: number }) => record.auctionVolume < 10_000_000)).toBe(true)
  await page.getByRole('button', { name: '未通过', exact: false }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await page.getByRole('button', { name: '核验少一元排除', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('9,999,999 元')
  await expect(page.getByRole('dialog')).toContainText('竞价量占比达标也须满足此项')
  await page.keyboard.press('Escape')
  await page.getByRole('button', { name: '待核验', exact: false }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await expect(page.locator('.auction-table tbody')).toContainText('缺额待核验')
})

test('每30秒刷新并累计保留入选，缺失或不再满足不移除，重载与导出保留证据', async ({ page }) => {
  await page.clock.install({ time: new Date('2026-11-18T09:26:00+08:00') })
  await page.clock.pauseAt(new Date('2026-11-18T09:26:01+08:00'))
  const base = auctionDemo().records[0]
  let phase = 0, requests = 0
  await page.route('**/api/auction*', route => {
    requests++
    return route.fulfill({ json: {
      ...auctionTemplate(), source: '保留入选受控数据',
      records: phase === 0 ? [{ ...base, name: '先入选甲' }] : phase === 1 ? [{ ...base, name: '先入选甲', price091500: null }, { ...base, code: 'SH600000', name: '后入选乙' }] : [],
      automatic: { fetchedAt: `2026-11-18T09:26:${phase ? '31' : '01'}+08:00`, asOf: `2026-11-18T09:26:${phase ? '31' : '01'}+08:00`, isToday: true, stale: false, poolCount: phase === 1 ? 2 : 1, scannedCount: phase === 1 ? 2 : 1, incompleteCount: phase === 1 ? 1 : 0, warnings: [] },
    } })
  })
  await page.goto('/auction')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(1)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('a-share-auction-matches-v1'))).not.toBeNull()
  const initialRequests = requests
  phase = 1
  await page.clock.runFor(29999)
  expect(requests).toBe(initialRequests)
  await page.clock.runFor(1)
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  expect(requests).toBe(initialRequests + 1)
  await expect(page.locator('.auction-table tbody')).toContainText('已保留入选')
  await page.getByRole('button', { name: '核验先入选甲', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('09:15:00 11.00 元')
  await expect(page.getByRole('dialog')).toContainText('已保留入选')
  await expect(page.getByRole('dialog')).toContainText('保留入选受控数据')
  await page.keyboard.press('Escape')
  phase = 2
  await page.getByRole('button', { name: '刷新竞价', exact: true }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await page.reload()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  const event = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出入选', exact: true }).click()
  const download = await event
  const exported = JSON.parse(await readFile((await download.path())!, 'utf8'))
  expect(exported.records).toHaveLength(2)
  expect(exported.records[0]).toMatchObject({ price091500: 11, retainedMatch: { source: '保留入选受控数据' } })
  await page.getByLabel('竞价量占昨日成交量阈值').fill('5')
  await page.getByRole('button', { name: '应用条件', exact: true }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(0)
  await page.getByRole('button', { name: '清空快照', exact: true }).click()
  expect(await page.evaluate(() => localStorage.getItem('a-share-auction-matches-v1'))).toBeNull()
})

test('开竞价01或02秒涨停可入选，保留实际时点并可导出重导入', async ({ page }) => {
  const base = auctionDemo().records[0]
  const records = [
    { ...base, name: '01秒涨停', price091500: null, price091501: 11 },
    { ...base, code: 'SH600000', name: '02秒涨停', price091500: 10.99, price091502: 11 },
    { ...base, code: 'SZ000002', name: '未涨停样本', price091500: null, price091501: 10.99 },
    { ...base, code: 'SZ000003', name: '开竞价缺失', price091500: null },
  ]
  await page.route('**/api/auction', route => route.fulfill({ json: {
    ...auctionTemplate(), records, source: '开竞价秒级受控测试',
    automatic: { fetchedAt: '2026-11-18T02:00:00Z', asOf: '2026-11-18T02:00:00Z', isToday: false, stale: false, poolCount: 4, scannedCount: 4, incompleteCount: 1, warnings: [] },
  } }))
  await page.goto('/auction')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.auction-table tbody')).toContainText('09:15:01')
  await expect(page.locator('.auction-table tbody')).toContainText('09:15:02')
  await page.getByRole('button', { name: '核验01秒涨停', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('09:15:00 缺失 / 09:15:01 11.00 元')
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出入选', exact: true }).click()
  const download = await downloadEvent
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const buffer = Buffer.concat(chunks)
  const exported = JSON.parse(buffer.toString())
  expect(exported.records).toHaveLength(2)
  expect(exported.records[0]).toMatchObject({ price091500: null, price091501: 11 })
  expect(exported.records[1].price091502).toBe(11)
  await page.getByRole('button', { name: '导入竞价快照', exact: true }).click()
  await page.getByLabel('选择竞价 JSON 文件').setInputFiles({ name: 'opening.json', mimeType: 'application/json', buffer })
  await page.getByRole('button', { name: '校验并预览', exact: true }).click()
  await page.getByRole('button', { name: '确认导入 2 条', exact: true }).click()
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.auction-table tbody')).toContainText('09:15:01')
  await expect(page.locator('.auction-table tbody')).toContainText('09:15:02')
})

test('新增58/59秒比较在自动名单、核验和导出中一致生效', async ({ page }) => {
  const base = auctionDemo().records[0]
  const records = [
    { ...base, name: '58秒样本', price092457: null, price092458: 10.3, price092459: null, auctionTime: '09:25:02' },
    { ...base, code: 'SH600000', name: '59秒样本', price092457: 10.6, price092458: 10.5, price092459: 10.3, auctionTime: '09:25:02' },
    { ...base, code: 'SZ000002', name: '相等不入选', price092457: null, price092458: 10.5, price092459: 10.6, auctionTime: '09:25:02' },
  ]
  await page.route('**/api/auction', route => route.fulfill({ json: {
    ...auctionTemplate(), records, source: '秒级条件受控测试',
    automatic: { fetchedAt: '2026-11-18T02:00:00Z', asOf: '2026-11-18T02:00:00Z', isToday: false, stale: false, poolCount: 3, scannedCount: 3, incompleteCount: 0, warnings: [] },
  } }))
  await page.goto('/auction')
  await expect(page.locator('.auction-table tbody tr')).toHaveCount(2)
  await expect(page.locator('.auction-table tbody')).toContainText('09:24:58')
  await expect(page.locator('.auction-table tbody')).toContainText('09:24:59')
  await page.getByRole('button', { name: '核验58秒样本', exact: true }).click()
  await expect(page.getByRole('dialog')).toContainText('09:25:02 10.50 元')
  await expect(page.getByRole('dialog')).toContainText('09:24:58 10.30 元')
  await page.getByRole('button', { name: '关闭弹窗' }).click()
  const downloadEvent = page.waitForEvent('download')
  await page.getByRole('button', { name: '导出入选', exact: true }).click()
  const download = await downloadEvent
  const stream = await download.createReadStream()
  const chunks: Buffer[] = []
  for await (const chunk of stream!) chunks.push(Buffer.from(chunk))
  const exported = JSON.parse(Buffer.concat(chunks).toString())
  expect(exported.records).toHaveLength(2)
  expect(exported.records[0]).toMatchObject({ price092457: null, price092458: 10.3, auctionTime: '09:25:02' })
  expect(exported.records[1].price092459).toBe(10.3)
})
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
