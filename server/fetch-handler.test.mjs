import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createFetchHandler } from './fetch-handler.mjs'
import { listResearchSkills } from './research.mjs'

const origin='https://dashboard.example'
const skillSources=Object.fromEntries([['tape','a-share-tape'],['fundamentals','a-share-fundamentals'],['risk','a-share-risk-review']].map(([id,folder])=>[id,readFileSync(new URL('../.agents/skills/'+folder+'/SKILL.md',import.meta.url),'utf8')]))
const handle=createFetchHandler({skillSources})
const assets={ASSETS:{fetch:async()=>{throw new Error('API must not reach static assets')}}}
const request=(path,options)=>new Request(origin+path,options)
const post=(path,body,headers={})=>request(path,{method:'POST',headers:{'Content-Type':'application/json',Origin:origin,...headers},body:JSON.stringify(body)})

test('Fetch API returns JSON config and JSON 404; unknown API never falls back to HTML',async()=>{
  const config=await handle(request('/api/ai/config'),assets)
  assert.equal(config.status,200)
  assert.match(config.headers.get('content-type'),/application\/json/)
  assert.equal(config.headers.get('cache-control'),'no-store')
  assert.deepEqual((await config.json()).providers.map(p=>p.configured),[false,false])
  for(const path of ['/api','/api/missing','/api/ai/config/']){
    const response=await handle(request(path),assets)
    assert.equal(response.status,404)
    assert.equal((await response.json()).error,'接口不存在')
  }
})

test('Frontend routes and files are delegated to the assets binding',async()=>{
  for(const path of ['/market','/settings','/assets/app.js']){
    const original=request(path)
    const response=await handle(original,{ASSETS:{fetch:async received=>{
      assert.equal(received,original)
      return new Response('asset body',{headers:{'Content-Type':'text/html'}})
    }}})
    assert.equal(await response.text(),'asset body')
  }
})

test('Bundled Skill sources match Node versions without a runtime filesystem',async()=>{
  const response=await handle(request('/api/research/skills'),assets)
  assert.equal(response.status,200)
  assert.deepEqual((await response.json()).skills,listResearchSkills())
  const changed=createFetchHandler({skillSources:{...skillSources,tape:skillSources.tape+'\nAdditional check.'}})
  const updated=await (await changed(request('/api/research/skills'),assets)).json()
  assert.notEqual(updated.skills[0].version,listResearchSkills()[0].version)
  const missing=createFetchHandler({skillSources:{}})
  assert.equal((await missing(request('/api/research/skills'),assets)).status,502)
})

test('Fetch requests preserve same-origin security and validate body size / JSON / media type',async()=>{
  const body={provider:'deepseek',credentials:{apiKey:'test-user-key',model:'test-model'}}
  for(const headers of [{Origin:'https://attacker.example'},{'Sec-Fetch-Site':'cross-site'},{Origin:'null'}]){
    assert.equal((await handle(post('/api/ai/test',body,headers),assets)).status,403)
  }
  const bad=await handle(request('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'}),assets)
  assert.equal(bad.status,400)
  assert.equal((await handle(post('/api/ai/test',{...body,padding:'汉'.repeat(1500)}),assets)).status,400)
  assert.equal((await handle(request('/api/ai/test',{method:'POST',body:'{}'}),assets)).status,415)
  assert.equal((await handle(post('/api/ai/test',{}),assets)).status,400)
})

test('Streaming UTF-8 body uses each caller key and never leaks credentials',async()=>{
  const calls=[]
  const connection=createFetchHandler({skillSources,fetcher:async(url,options)=>{
    calls.push({url,options})
    return Response.json({choices:[{message:{content:'OK'}}]})
  }})
  for(const key of ['first-user-key','second-user-key']){
    const bytes=new TextEncoder().encode(JSON.stringify({provider:'deepseek',credentials:{apiKey:key,model:'test-model'},note:'中文'}))
    // Split within a Chinese character to exercise streaming decoding.
    const split=bytes.indexOf(0xe4)+1
    const body=new ReadableStream({start(controller){controller.enqueue(bytes.slice(0,split));controller.enqueue(bytes.slice(split));controller.close()}})
    const response=await connection(request('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:origin},body,duplex:'half'}),assets)
    assert.equal(response.status,200)
    const text=await response.text()
    assert.ok(!text.includes(key));assert.ok(text.includes('连接成功'))
  }
  assert.deepEqual(calls.map(call=>call.options.headers.Authorization),['Bearer first-user-key','Bearer second-user-key'])
  assert.ok(calls.every(call=>call.url==='https://api.deepseek.com/chat/completions'&&call.options.redirect==='error'))
})

test('Market, fundamentals and Skill checks run through Fetch routing with server facts',async()=>{
  let refresh=false
  const facts={code:'SH600519',name:'测试公司',reports:[],valuation:null,warnings:[],sources:[]}
  const market={asOf:'2026-11-16T07:00:00Z',isToday:true,stale:false,weak:false,scannedCount:0,indices:[],warnings:[],source:{name:'测试行情'},candidates:[]}
  const research=createFetchHandler({skillSources,getMarket:async force=>{refresh=force;return market},getFundamentals:async code=>{assert.equal(code,facts.code);return facts}})
  assert.deepEqual(await (await research(request('/api/market?refresh=1'),assets)).json(),market)
  assert.equal(refresh,true)
  assert.deepEqual(await (await research(request('/api/fundamentals?code=SH600519'),assets)).json(),facts)
  const result=await research(post('/api/research/analyze',{code:facts.code,skill:'risk',mode:'checks'}),assets)
  assert.equal(result.status,200)
  const data=await result.json()
  assert.equal(data.skill.version,listResearchSkills().find(skill=>skill.id==='risk').version)
  assert.ok(data.gaps.length>0);assert.ok(data.checks.some(item=>item.level==='missing'))
})
