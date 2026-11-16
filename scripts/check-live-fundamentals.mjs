import { chromium,expect } from '@playwright/test'

const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(process.env.APP_URL||'http://127.0.0.1:5180')
  await page.getByRole('button',{name:'先看看演示组合'}).click()
  await page.getByRole('button',{name:'加载公开基本面'}).click()
  const panel=page.locator('#fundamentals')
  try{await expect(panel.locator('.fundamental-metrics')).toBeVisible({timeout:25000})}
  catch{await page.getByRole('button',{name:'更新财报'}).click();await expect(panel.locator('.fundamental-metrics')).toBeVisible({timeout:25000})}
  await expect(panel).toContainText('报告截止')
  await expect(panel.locator('.research-sources')).toContainText('东方财富')
  await expect(panel.locator('.fundamental-metrics')).not.toContainText('NaN')
  await panel.screenshot({path:'test-results/live-fundamentals.png',animations:'disabled'})
  console.log(JSON.stringify({report:await panel.locator('.company-research-heading').innerText(),metrics:await panel.locator('.fundamental-metrics').innerText(),errors},null,2))
  if(errors.length)process.exitCode=1
}finally{await browser.close()}
