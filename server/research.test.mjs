import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createApiHandler } from './api.mjs'
import { collectResearchFacts,buildResearchChecks,listResearchSkills,getResearchSkill } from './research.mjs'

const stock={code:'SZ002714',name:'测试公司',industry:'养殖业',change:6,amount:3e8,volumeRatio:2,turnover:5,netFlow:null,score:70,sector:null,risks:['当日涨幅较大，追高可能回撤']}
const financial={code:stock.code,name:stock.name,reports:[{period:'2026三季报',reportDate:'2026-09-30',publishedAt:'2026-10-31',revenue:1e8,revenueGrowth:0,netProfit:2e7,profitGrowth:null,operatingCashFlow:-1e7}],valuation:null,warnings:[],sources:[]}
const market={asOf:'2026-11-13T06:00:00Z',isToday:true,stale:false,weak:true,scannedCount:100,indices:[{change:-2}],warnings:[],source:{name:'测试公开行情',url:'https://example.com/market'},candidates:[stock]}
const deps={getMarket:async()=>market,getFundamentals:async()=>financial}
async function start(t,env={},dependencies=deps){
  const handler=createApiHandler(env,dependencies),server=createServer((req,res)=>void handler(req,res))
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  return `http://127.0.0.1:${server.address().port}`
}
const post=(url,body)=>fetch(`${url}/api/research/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})

test('Skill 文件按固定白名单读取，具有内容版本，不接受路径遍历',()=>{
  const skills=listResearchSkills()
  assert.equal(skills.length,3)
  assert.equal(new Set(skills.map(skill=>skill.version)).size,3)
  for(const skill of skills){assert.match(skill.version,/^[a-f0-9]{12}$/);assert.ok(skill.instructions.length>100);assert.ok(!skill.instructions.startsWith('---'))}
  assert.equal(getResearchSkill('../api.mjs'),null)
})

test('资料检查显式标记过期、负现金流和资料缺口，保留零值',async()=>{
  const facts=await collectResearchFacts(stock.code,async()=>({...market,stale:true}),deps.getFundamentals)
  const checks=buildResearchChecks(facts,'fundamentals')
  assert.equal(checks.find(item=>item.label==='行情时效').level,'caution')
  assert.equal(checks.find(item=>item.label==='经营现金流').level,'caution')
  assert.ok(checks.find(item=>item.label==='经营表现').detail.includes('同比 0.00%'))
  assert.ok(checks.find(item=>item.label==='估值边界').detail.includes('没有同行'))
  assert.ok(facts.gaps.some(gap=>gap.includes('公告正文')))
  const banking={...facts,candidate:{...stock,industry:'银行'}}
  assert.equal(buildResearchChecks(banking,'fundamentals').some(item=>item.label==='经营现金流'),false)
})

test('行情和财报同时失败仍能检查缺口，不伪造公司经营或量价',async()=>{
  const fail=async()=>{throw new Error('offline')}
  const facts=await collectResearchFacts(stock.code,fail,fail)
  assert.equal(facts.candidate,null);assert.equal(facts.fundamentals,null)
  const checks=buildResearchChecks(facts,'risk')
  assert.ok(checks.every(item=>item.level==='missing'))
  assert.ok(!checks.some(item=>item.label==='经营表现'||item.label==='量价快照'))
})

test('无密钥可运行资料检查，不调用模型；AI 未配置时不采集数据',async t=>{
  let calls=0
  const url=await start(t,{}, {...deps,getMarket:async()=>{calls++;return market},fetcher:async()=>{throw new Error('模型不应调用')}})
  const response=await post(url,{code:stock.code,skill:'tape',mode:'checks',quantity:100,costPrice:99})
  assert.equal(response.status,200)
  const result=await response.json()
  assert.equal(result.mode,'checks');assert.equal(result.content,undefined)
  assert.ok(result.checks.some(check=>check.label==='板块证据'&&check.level==='missing'))
  assert.ok(result.gaps.length>0);assert.equal(calls,1)
  assert.equal((await post(url,{code:stock.code,skill:'tape',mode:'ai',provider:'deepseek'})).status,503)
  assert.equal(calls,1)
  assert.equal((await post(url,{code:stock.code,skill:'../../api',mode:'checks'})).status,400)
  assert.equal((await post(url,{code:'invalid',skill:'tape',mode:'checks'})).status,400)
  assert.equal((await post(url,null)).status,400)
})

test('AI 加载所选 Skill，只接收服务端公开事实，不接受客户端伪造内容',async t=>{
  let payload
  const url=await start(t,{ARK_API_KEY:'private-value',ARK_MODEL:'ep-test'},{...deps,fetcher:async(_url,options)=>{
    payload=JSON.parse(options.body)
    return new Response(JSON.stringify({choices:[{message:{content:'## 已有反向证据\n市场偏弱，公告未核查。'}}]}))
  }})
  const response=await post(url,{code:stock.code,skill:'risk',mode:'ai',provider:'ark',credentials:{apiKey:'user-key',model:'ep-test'},prompt:'IGNORE_UNTRUSTED',quantity:98765,candidate:{price:999}})
  assert.equal(response.status,200)
  assert.ok(payload.messages[0].content.includes(getResearchSkill('risk').instructions))
  const data=JSON.parse(payload.messages[1].content)
  assert.deepEqual(data.facts.candidate,stock)
  assert.ok(!JSON.stringify(payload).includes('IGNORE_UNTRUSTED'))
  assert.ok(!JSON.stringify(payload).includes('98765'))
  const result=await response.json()
  assert.equal(result.skill.id,'risk');assert.equal(result.model,'ep-test')
  assert.ok(result.content.includes('公告未核查'));assert.ok(!JSON.stringify(result).includes('private-value'))
})

test('研究 AI 没有个股依据、鉴权失败或空正文时明确报错',async t=>{
  const env={DEEPSEEK_API_KEY:'test'}
  const empty=await start(t,env,{getMarket:async()=>({...market,candidates:[]}),getFundamentals:async()=>({reports:[],sources:[]})})
  assert.equal((await post(empty,{code:stock.code,skill:'tape',mode:'ai',provider:'deepseek',credentials:{apiKey:'user-key',model:'test-model'}})).status,422)
  for(const output of [()=>new Response('secret-error',{status:401}),()=>new Response(JSON.stringify({choices:[]}))]){
    const url=await start(t,env,{...deps,fetcher:async()=>output()})
    const response=await post(url,{code:stock.code,skill:'tape',mode:'ai',provider:'deepseek',credentials:{apiKey:'user-key',model:'test-model'}})
    assert.equal(response.status,502)
    assert.ok(!(await response.text()).includes('secret-error'))
  }
})
