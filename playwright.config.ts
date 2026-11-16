import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir:'./e2e',
  fullyParallel:true,
  workers:2,
  use:{baseURL:'http://127.0.0.1:4173',headless:true,trace:'retain-on-failure',launchOptions:{executablePath:process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE}},
  projects:[{name:'desktop',use:{viewport:{width:1440,height:1080}}},{name:'mobile',use:{viewport:{width:390,height:844}}}],
  webServer:{command:'node node_modules/vite/bin/vite.js --host 127.0.0.1 --port 4173 --strictPort',url:'http://127.0.0.1:4173',reuseExistingServer:!process.env.CI},
})
