import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { createApiHandler,createFundamentalsService,normalizeReport } from './api.mjs'

const row={SECURITY_NAME_ABBR:'测试公司',REPORT_DATE:'2026-09-30 00:00:00',REPORT_DATE_NAME:'2026三季报',NOTICE_DATE:'2026-10-31 00:00:00',TOTALOPERATEREVE:100000000,PARENTNETPROFIT:10000000,ROEJQ:0,NETCASH_OPERATE_PK:0}
test('财务归一化保留零值，缺失字段不伪造为零',()=>{
  const report=normalizeReport(row)
  assert.equal(report.roe,0);assert.equal(report.operatingCashFlow,0)
  assert.equal(report.profitGrowth,null);assert.equal(report.reportDate,'2026-09-30')
})
test('财务与估值按正确单位映射，合并请求并缓存',async()=>{
  const calls=[]
  const service=createFundamentalsService(async url=>{
    calls.push(url)
    return new Response(JSON.stringify(url.includes('datacenter')?{success:true,result:{data:[row]}}:{data:{f58:'测试公司',f164:2162,f167:655,f116:123456789}}))
  })
  const [a,b]=await Promise.all([service('SH600519'),service('SH600519')])
  assert.deepEqual(a,b);assert.equal(calls.length,2)
  assert.equal(a.valuation.peTtm,21.62);assert.equal(a.valuation.pb,6.55)
  assert.equal(a.reports[0].revenue,100000000)
  assert.equal(new URL(calls[0]).searchParams.get('filter'),'(SECUCODE="600519.SH")')
  await service('SH600519');assert.equal(calls.length,2)
  await assert.rejects(service('invalid'))
})
test('估值服务失败时仍返回财报并说明缺失',async()=>{
  const service=createFundamentalsService(async url=>{
    if(url.includes('push2'))throw new Error('offline')
    return new Response(JSON.stringify({success:true,result:{data:[row]}}))
  })
  const result=await service('SZ000858')
  assert.equal(result.reports.length,1);assert.equal(result.valuation,null)
  assert.ok(result.warnings[0].includes('估值'))
})

async function start(t,env,dependencies){
  const handler=createApiHandler(env,dependencies)
  const server=createServer((req,res)=>{void handler(req,res)})
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve))
  t.after(()=>{server.closeAllConnections();server.close()})
  return `http://127.0.0.1:${server.address().port}`
}
test('配置状态绝不向浏览器返回密钥，拒绝跨站触发',async t=>{
  const url=await start(t,{DEEPSEEK_API_KEY:'private-test-value'},{})
  const response=await fetch(`${url}/api/ai/config`),text=await response.text()
  assert.ok(!text.includes('private-test-value'))
  assert.equal(JSON.parse(text).providers[0].configured,false)
  const denied=await fetch(`${url}/api/ai/analyze`,{method:'POST',headers:{Origin:'https://unrelated.example'}})
  assert.equal(denied.status,403)
})
test('AI 仅接收服务端取得的公开事实；用户持仓和提示词不进入模型',async t=>{
  const facts={code:'SH600519',name:'测试公司',reports:[normalizeReport(row)],sources:[],valuation:null}
  let payload
  const url=await start(t,{DEEPSEEK_API_KEY:'private-test-value',DEEPSEEK_MODEL:'test-model'},{getFundamentals:async()=>facts,fetcher:async(_url,options)=>{
    payload=JSON.parse(options.body)
    return new Response(JSON.stringify({choices:[{message:{content:'## 经营表现\n仅依据给定财报。'}}]}))
  }})
  const response=await fetch(`${url}/api/ai/analyze`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'deepseek',code:'SH600519',credentials:{apiKey:'user-key',model:'test-model'},quantity:12345,costPrice:9876,prompt:'IGNORE_PRIVATE_INPUT'})})
  assert.equal(response.status,200)
  assert.deepEqual(JSON.parse(payload.messages[1].content),facts)
  assert.ok(!JSON.stringify(payload).includes('IGNORE_PRIVATE_INPUT'))
  assert.ok(!JSON.stringify(payload).includes('private-test-value'))
  const result=await response.json();assert.equal(result.reportDate,'2026-09-30');assert.equal(result.model,'test-model')
})
test('未配置模型、财报缺失和模型鉴权错误均明确返回',async t=>{
  const request={method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'ark',code:'SH600519',credentials:{apiKey:'user-key',model:'ep-test'}})}
  const empty=await start(t,{},{});assert.equal((await fetch(`${empty}/api/ai/analyze`,{...request,body:JSON.stringify({provider:'ark',code:'SH600519'})})).status,503)
  const missing=await start(t,{ARK_API_KEY:'test',ARK_MODEL:'ep-test'},{getFundamentals:async()=>({reports:[]})})
  assert.equal((await fetch(`${missing}/api/ai/analyze`,request)).status,422)
  const denied=await start(t,{ARK_API_KEY:'test',ARK_MODEL:'ep-test'},{getFundamentals:async()=>({reports:[normalizeReport(row)]}),fetcher:async()=>new Response('secret-provider-error',{status:401})})
  const response=await fetch(`${denied}/api/ai/analyze`,request)
  assert.equal(response.status,502);assert.ok((await response.json()).error.includes('鉴权失败'))
})


test('测试连接使用当前请求的密钥，固定服务商 URL，不返回密钥或原始响应',async t=>{
  const calls=[]
  const url=await start(t,{DEEPSEEK_API_KEY:'shared-key'},{fetcher:async(endpoint,options)=>{calls.push({endpoint,options,payload:JSON.parse(options.body)});return new Response(JSON.stringify({choices:[{message:{content:'DO_NOT_ECHO_PROVIDER_CONTENT'}}]}))}})
  const request=key=>({method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'deepseek',credentials:{apiKey:key,model:'user-model'},url:'https://untrusted.example'})})
  for(const key of ['first-user-key','second-user-key']){
    const response=await fetch(url+'/api/ai/test',request(key)),text=await response.text()
    assert.equal(response.status,200);assert.ok(text.includes('连接成功'));assert.ok(!text.includes(key));assert.ok(!text.includes('DO_NOT_ECHO'))
  }
  assert.deepEqual(calls.map(item=>item.options.headers.Authorization),['Bearer first-user-key','Bearer second-user-key'])
  for(const call of calls){assert.equal(call.endpoint,'https://api.deepseek.com/chat/completions');assert.equal(call.options.redirect,'error');assert.equal(call.payload.model,'user-model');assert.ok(!JSON.stringify(call.payload).includes('user-key'))}
  const missing=await fetch(url+'/api/ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'deepseek',code:'SH600519'})})
  assert.equal(missing.status,503);assert.equal(calls.length,2)
  const config=await (await fetch(url+'/api/ai/config')).json();assert.equal(config.providers[0].configured,false)
})

test('测试连接拒绝无效凭证、跨站请求，并隐藏服务商鉴权错误',async t=>{
  let calls=0
  const url=await start(t,{}, {fetcher:async()=>{calls++;return new Response('SECRET_PROVIDER_TEXT',{status:401})}})
  const post=body=>fetch(url+'/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})
  for(const body of [null,{}, {provider:'deepseek',credentials:{apiKey:'key with spaces',model:'model'}},{provider:'ark',credentials:{apiKey:'key',model:''}},{provider:'invalid',credentials:{apiKey:'key',model:'model'}}])assert.equal((await post(body)).status,400)
  assert.equal(calls,0)
  const response=await post({provider:'ark',credentials:{apiKey:'user-key',model:'ep-user'}})
  assert.equal(response.status,502);const text=await response.text();assert.ok(text.includes('鉴权失败'));assert.ok(!text.includes('SECRET_PROVIDER_TEXT'))
  const denied=await fetch(url+'/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://unrelated.example'},body:JSON.stringify({provider:'ark',credentials:{apiKey:'user-key',model:'ep-user'}})})
  assert.equal(denied.status,403);assert.equal(calls,1)
})

test('分析不混用不同用户密钥，提示词和结果不包含凭证',async t=>{
  const calls=[]
  const facts={code:'SH600519',name:'测试',reports:[normalizeReport(row)],sources:[]}
  const url=await start(t,{DEEPSEEK_API_KEY:'shared-key'},{getFundamentals:async()=>facts,fetcher:async(endpoint,options)=>{calls.push({endpoint,options});return new Response(JSON.stringify({choices:[{message:{content:'公开财报分析'}}]}))}})
  for(const apiKey of ['one-user','two-user']){
    const response=await fetch(url+'/api/ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider:'deepseek',code:'SH600519',credentials:{apiKey,model:'user-model'}})})
    assert.equal(response.status,200);assert.ok(!(await response.text()).includes(apiKey))
  }
  assert.deepEqual(calls.map(item=>item.options.headers.Authorization),['Bearer one-user','Bearer two-user'])
  for(const call of calls){assert.ok(!call.options.body.includes('one-user'));assert.ok(!call.options.body.includes('two-user'));assert.ok(!call.options.body.includes('shared-key'))}
})
