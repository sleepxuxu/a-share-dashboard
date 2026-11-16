import { chromium,expect } from '@playwright/test'

const browser=await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE})
try{
  const page=await browser.newPage({viewport:{width:1440,height:1080}})
  const errors=[]
  page.on('pageerror',error=>errors.push(error.message))
  await page.goto(`${process.env.APP_URL||'http://127.0.0.1:5180'}/market`)
  await expect(page.locator('.market-meta')).toBeVisible({timeout:45000})
  await expect(page.locator('.index-card')).toHaveCount(3)
  const candidates=await page.locator('.candidate-card').count()
  if(candidates){
    await page.locator('.candidate-details summary').first().click()
    await expect(page.locator('.candidate-evidence').first()).toBeVisible()
  }else await expect(page.locator('.candidate-empty')).toBeVisible()
  await page.evaluate(()=>scrollTo(0,0))
  await page.screenshot({path:'test-results/live-market-desktop.png',fullPage:true,animations:'disabled'})
  await page.setViewportSize({width:390,height:844})
  await page.evaluate(()=>scrollTo(0,0))
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true)
  await page.screenshot({path:'test-results/live-market-mobile.png',fullPage:true,animations:'disabled'})
  console.log(JSON.stringify({snapshot:await page.locator('.market-meta').innerText(),indices:await page.locator('.index-card').allTextContents(),candidates:await page.locator('.candidate-card').allTextContents(),errors},null,2))
  if(errors.length)process.exitCode=1
}finally{await browser.close()}
