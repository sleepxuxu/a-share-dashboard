import { chromium } from 'playwright'

const browser = await chromium.launch({executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE})
try {
  const page = await browser.newPage({viewport:{width:1440,height:1080}})
  const errors = []
  page.on('pageerror',error=>errors.push(error.message))
  await page.addInitScript(()=>{
    localStorage.setItem('a-share-holdings',JSON.stringify({version:1,state:{holdings:[
      {code:'SH600519',quantity:100,costPrice:1420},
      {code:'SZ000858',quantity:100,costPrice:100},
    ]}}))
    localStorage.setItem('a-share-settings',JSON.stringify({state:{autoRefresh:false,hideAmounts:false},version:0}))
  })
  await page.goto(process.env.APP_URL || 'http://127.0.0.1:5180')
  await page.waitForFunction(()=>!document.querySelector('.refresh-button')?.disabled,{},{timeout:28000})
  const rows=await page.locator('tbody tr').allTextContents()
  const warning=await page.locator('.error-banner').allTextContents()
  console.log(JSON.stringify({rows,warning,errors},null,2))
  if(warning.length || errors.length || rows.length!==2) process.exitCode=1
} finally {
  await browser.close()
}
