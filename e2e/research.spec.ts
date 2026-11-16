import { test,expect,type Page } from '@playwright/test'

const report={period:'2026三季报',reportDate:'2026-09-30',publishedAt:'2026-10-31',revenue:133283652508.95,revenueGrowth:1.82,netProfit:64467425981.95,profitGrowth:-.25,roe:24.47,grossMargin:89.58,netMargin:50.94,debtRatio:11.90,eps:51.53,operatingCashFlow:84058979832.29}
async function setup(page:Page){
  await page.addInitScript(()=>sessionStorage.setItem('gujian-model-credentials',JSON.stringify({deepseek:{apiKey:'browser-test-key',model:'test-model'}})))
  await page.route('**/api/ai/config',route=>route.fulfill({json:{providers:[{id:'deepseek',name:'DeepSeek',configured:true,model:'test-model'},{id:'ark',name:'火山方舟',configured:false,model:''}]}}))
  await page.route('**/api/fundamentals?**',route=>{
    const code=new URL(route.request().url()).searchParams.get('code')!
    return route.fulfill({json:{code,name:code==='SH600519'?'贵州茅台':'宁德时代',fetchedAt:'2026-11-13T02:00:00Z',valuation:{peTtm:21.62,pb:6.55,marketCap:1776303450940},reports:[report],warnings:[],sources:[{name:'东方财富 · 财务分析',url:'https://emweb.securities.eastmoney.com/PC_HSF10/FinanceAnalysis/Index?type=web&code='+code}]}})
  })
}
test('基本面报告期、真实与演示区分、股票切换和 AI 公开数据请求',async({page},testInfo)=>{
  await setup(page)
  let payload:unknown
  await page.route('**/api/ai/analyze',route=>{
    payload=route.request().postDataJSON()
    return route.fulfill({json:{content:'## 经营表现\n2026三季报营收同比增长 1.82%（来源：东方财富）。\n## 需要继续核实\n应结合原始公告核实。',provider:'DeepSeek',model:'test-model',generatedAt:'2026-11-13T02:00:00Z',reportDate:'2026-09-30'}})
  })
  await page.goto('/')
  await page.getByRole('button',{name:'先看看演示组合'}).click()
  await expect(page.getByRole('button',{name:'加载公开基本面'})).toBeVisible()
  await page.getByRole('button',{name:'加载公开基本面'}).click()
  const panel=page.locator('#fundamentals')
  await expect(panel).toContainText('报告截止 2026-09-30')
  await expect(panel).toContainText('1,332.84 亿元')
  await expect(panel).toContainText('21.62 倍')
  await expect(panel).toContainText('与演示持仓、演示行情分别展示')
  await panel.getByRole('button',{name:'生成分析',exact:true}).click()
  await expect(panel.locator('.analysis-prose')).toContainText('营收同比增长 1.82%')
  expect(payload).toEqual({code:'SH600519',provider:'deepseek',credentials:{apiKey:'browser-test-key',model:'test-model'}})
  await page.screenshot({path:testInfo.outputPath('research.png'),fullPage:true,animations:'disabled'})
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true)
  for(const value of await page.locator('.summary-value').all())expect(await value.evaluate(node=>node.scrollWidth<=node.clientWidth)).toBe(true)
  const size=await page.locator('.stock-name').first().evaluate(node=>parseFloat(getComputedStyle(node).fontSize))
  expect(size).toBeGreaterThanOrEqual(15)
  await page.getByLabel('选择研究股票').selectOption('SZ300750')
  await expect(panel.locator('.company-research-heading')).toContainText('宁德时代')
  await expect(panel.locator('.analysis-prose')).toHaveCount(0)
  await page.getByLabel('分析模型').selectOption('ark')
  await expect(panel.getByRole('button',{name:'生成分析'})).toBeDisabled()
  await expect(panel).toContainText('火山方舟尚未配置')
})
test('财报不可用时不生成分析，模型错误可以重试',async({page})=>{
  await setup(page)
  await page.route('**/api/ai/analyze',route=>route.fulfill({status:502,json:{error:'模型限流，请稍后再试'}}))
  await page.goto('/')
  await page.getByRole('button',{name:'先看看演示组合'}).click()
  await page.getByRole('button',{name:'加载公开基本面'}).click()
  await page.getByRole('button',{name:'生成分析',exact:true}).click()
  await expect(page.getByRole('alert')).toContainText('模型限流')
  await expect(page.getByRole('button',{name:'生成分析',exact:true})).toBeEnabled()
  await page.route('**/api/fundamentals?**',route=>route.fulfill({json:{code:'SH600519',name:'贵州茅台',fetchedAt:'2026-11-13T02:00:00Z',reports:[],valuation:null,warnings:['财报暂未取得'],sources:[]}}))
  await page.getByRole('button',{name:'更新财报'}).click()
  await expect(page.locator('#fundamentals')).toContainText('财报暂未取得')
  await expect(page.getByRole('button',{name:'生成分析',exact:true})).toBeDisabled()
})
