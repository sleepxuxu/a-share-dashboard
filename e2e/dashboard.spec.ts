import { expect,test,type Page } from '@playwright/test'

test.beforeEach(async({page})=>{
  await page.route('**/api/fundamentals?**',route=>route.fulfill({json:{code:'SH600519',name:'测试公司',reports:[],valuation:null,warnings:['财报暂未取得'],sources:[],fetchedAt:'2026-11-13T02:00:00Z'}}))
  await page.route('**/api/ai/config',route=>route.fulfill({json:{providers:[{id:'deepseek',name:'DeepSeek',configured:false,model:'deepseek-flash'},{id:'ark',name:'火山方舟',configured:false,model:''}]}}))
})

async function offline(page:Page){
  await page.route(/https:\/\/(qt\.gtimg\.cn|hq\.sinajs\.cn|.*eastmoney\.com)\//,route=>route.abort())
}
async function addHolding(page:Page){
  await page.getByRole('button',{name:'添加持仓',exact:true}).first().click()
  const form=page.getByRole('dialog')
  await form.getByLabel('股票代码').fill('600519')
  await form.getByLabel('股票名称').fill('测试茅台')
  await form.getByLabel('持仓数量').fill('100')
  await form.getByLabel('成本均价').fill('1420')
  await form.getByRole('button',{name:'添加持仓',exact:true}).click()
}

test('录入、持久化、编辑和删除；断网按成本暂估',async({page})=>{
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  await offline(page)
  await page.goto('/')
  await expect(page.getByText('从你的第一笔持仓开始')).toBeVisible()
  await addHolding(page)
  await expect(page.getByRole('table')).toContainText('142,000.00')
  await expect(page.getByRole('table')).toContainText('行情暂不可用')
  await page.reload()
  await expect(page.getByRole('table')).toContainText('测试茅台')
  await expect.poll(()=>page.evaluate(()=>JSON.parse(localStorage.getItem('a-share-holdings')!).state.holdings[0].code)).toBe('SH600519')
  await page.getByRole('button',{name:'编辑测试茅台',exact:true}).click()
  await page.getByRole('dialog').getByLabel('持仓数量').fill('200')
  await page.getByRole('button',{name:'保存修改'}).click()
  await expect(page.getByRole('table')).toContainText('284,000.00')
  await page.getByRole('button',{name:'删除测试茅台',exact:true}).click()
  await page.getByRole('button',{name:'确认删除'}).click()
  await expect(page.getByText('从你的第一笔持仓开始')).toBeVisible()
  expect(errors).toEqual([])
})

test('演示模式隔离、图表渲染、隐藏金额与响应式布局',async({page},testInfo)=>{
  const errors:string[]=[]
  page.on('pageerror',e=>errors.push(e.message))
  let requests=0
  page.on('request',r=>{if(/gtimg|sinajs|eastmoney/.test(r.url()))requests++})
  await page.goto('/')
  await page.getByRole('button',{name:'先看看演示组合'}).click()
  await expect(page.getByText('正在浏览演示组合')).toBeVisible()
  await expect(page.getByRole('img',{name:/持仓配置环形图/})).toBeVisible()
  await expect(page.locator('canvas')).toHaveCount(2)
  await page.getByRole('button',{name:'隐藏金额',exact:true}).click()
  await expect(page.locator('.summary-value').first()).toHaveText('¥••••••')
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  await page.screenshot({path:testInfo.outputPath('dashboard.png'),fullPage:true,animations:'disabled'})
  await page.getByRole('button',{name:'使用我的持仓'}).click()
  await expect(page.getByText('从你的第一笔持仓开始')).toBeVisible()
  expect(requests).toBe(0)
  expect(errors).toEqual([])
})

test('CSV预览、合并、搜索与导出',async({page})=>{
  await offline(page)
  await page.goto('/')
  await page.getByRole('button',{name:'导入持仓',exact:true}).click()
  await page.getByLabel('CSV 内容').fill('代码,名称,数量,成本价,行业,买入日期\n600519,测试茅台,100,1420,食品饮料,\n000858,测试五粮液,200,100,食品饮料,')
  await page.getByRole('button',{name:'校验并预览'}).click()
  await expect(page.getByText('已校验 2 条持仓')).toBeVisible()
  await page.getByRole('button',{name:'确认导入 2 条'}).click()
  await page.getByRole('textbox',{name:'搜索持仓'}).fill('000858')
  await expect(page.locator('#holdings tbody tr')).toHaveCount(1)
  await expect(page.locator('#holdings tbody')).toContainText('测试五粮液')
  const downloadEvent=page.waitForEvent('download')
  await page.getByRole('button',{name:'导出',exact:true}).click()
  const download=await downloadEvent
  expect(download.suggestedFilename()).toMatch(/^股见-持仓-.*\.csv$/)
})

test('行情批量获取后回填名称，刷新失败保留上次价格',async({page})=>{
  let requests=0
  await offline(page)
  await page.route('https://qt.gtimg.cn/**',async route=>{
    requests++
    if(requests>1){await route.abort();return}
    const fields=Array(35).fill('0');fields[1]='QuoteDemo';fields[2]='600519';fields[3]='1500';fields[4]='1450';fields[33]='1510';fields[34]='1440'
    await route.fulfill({contentType:'application/javascript; charset=utf-8',body:`v_sh600519="${fields.join('~')}";`})
  })
  await page.addInitScript(()=>localStorage.setItem('a-share-holdings',JSON.stringify({state:{holdings:[{code:'SH600519',quantity:100,costPrice:1420}]},version:1})))
  await page.goto('/')
  await expect(page.getByRole('table')).toContainText('QuoteDemo')
  await expect(page.getByRole('table')).toContainText('150,000.00')
  expect(requests).toBe(1)
  expect(await page.evaluate(()=>JSON.parse(localStorage.getItem('a-share-holdings')!).state.holdings[0].name)).toBe('QuoteDemo')
  await page.getByRole('button',{name:'刷新',exact:true}).click()
  await expect(page.getByText('旧行情',{exact:true})).toBeVisible({timeout:25000})
  await expect(page.getByRole('table')).toContainText('150,000.00')
})

test('设置持久化，帮助弹窗可用 Escape 关闭',async({page})=>{
  await page.goto('/settings')
  const auto=page.getByRole('switch',{name:'自动刷新行情'})
  await auto.click()
  await page.reload()
  await expect(auto).toHaveAttribute('aria-checked','false')
  await page.getByRole('button',{name:'帮助中心'}).click()
  await expect(page.getByRole('dialog')).toContainText('集中度 HHI')
  await page.keyboard.press('Escape')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})

test('存储额度不足时显示提示，界面仍可操作',async({page})=>{
  await offline(page)
  await page.addInitScript(()=>{Storage.prototype.setItem=function(){throw new DOMException('Quota exceeded','QuotaExceededError')}})
  await page.goto('/')
  await addHolding(page)
  await expect(page.getByRole('alert')).toContainText('本地存储不可用')
  await expect(page.getByRole('table')).toContainText('测试茅台')
  await page.getByRole('button',{name:'帮助中心'}).click()
  await expect(page.getByRole('dialog')).toBeVisible()
})
