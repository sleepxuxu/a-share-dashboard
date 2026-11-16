import { useEffect,useRef,useState } from 'react'
import { Bot,RefreshCw,Eye,EyeOff,Check,Trash2 } from 'lucide-react'
import { fetchAiConfig,testModelConnection } from '../../services/researchService'
import { readModelCredentials,saveModelCredentials,clearModelCredentials } from '../../services/modelCredentials'
import type { AiConfig,AiProvider } from '../../types/fundamentals'

export function AiSettings(){
  const [config,setConfig]=useState<AiConfig|null>(null),[provider,setProvider]=useState<AiProvider>('deepseek')
  const [apiKey,setApiKey]=useState(''),[model,setModel]=useState(''),[visible,setVisible]=useState(false)
  const [error,setError]=useState(''),[notice,setNotice]=useState(''),[testing,setTesting]=useState(false)
  const request=useRef<AbortController|null>(null)
  const load=()=>{void fetchAiConfig().then(setConfig).catch(e=>setError(e.message))}
  useEffect(()=>{load();return()=>request.current?.abort()},[])
  useEffect(()=>{request.current?.abort();setTesting(false);const saved=readModelCredentials(provider);setApiKey(saved?.apiKey||'');setModel(saved?.model||(provider==='deepseek'?'deepseek-flash':''));setVisible(false);setError('');setNotice('')},[provider])
  function save(){setError('');setNotice('');try{saveModelCredentials(provider,{apiKey,model});setApiKey(apiKey.trim());setModel(model.trim());setNotice('配置已保存，本标签页刷新后仍可使用。');load()}catch(e){setError(e instanceof Error?e.message:'保存失败')}}
  function clear(){setError('');setNotice('');try{clearModelCredentials(provider);setApiKey('');setModel(provider==='deepseek'?'deepseek-flash':'');setVisible(false);setNotice('已清除当前服务商的配置。');load()}catch(e){setError(e instanceof Error?e.message:'清除失败')}}
  async function test(){
    setError('');setNotice('');const controller=new AbortController();request.current=controller;setTesting(true)
    try{const result=await testModelConnection(provider,{apiKey:apiKey.trim(),model:model.trim()},controller.signal);if(!controller.signal.aborted)setNotice(result.message+'；如有修改，请点击保存配置。')}
    catch(e){if(!controller.signal.aborted)setError(e instanceof Error?e.message:'连接失败，请重试。')}
    finally{if(!controller.signal.aborted)setTesting(false)}
  }
  return <section className="panel settings-panel ai-settings" id="ai-settings">
    <div className="panel-heading"><div className="section-title"><Bot size={20}/><h2>AI 模型设置</h2></div><button className="button secondary compact" onClick={load}>刷新状态</button></div>
    <div className="research-settings-body">
      <p>填写你自己的模型 API Key，即可生成基本面与 Skill 研究解读。保存配置立即生效，无需修改文件或重启服务。</p>
      <div className="provider-status-grid">{config?.providers.map(item=><div key={item.id}><strong>{item.name}</strong><span className="badge blue">{item.configured?'本标签页已填写':'待填写'}</span><p>{item.model||'请填写已开通的模型或接入点 ID'}</p></div>)}</div>
      <form className="model-config-form" onSubmit={event=>{event.preventDefault();save()}}>
        <label htmlFor="model-provider">模型服务商</label><select id="model-provider" value={provider} onChange={event=>setProvider(event.target.value as AiProvider)}><option value="deepseek">DeepSeek</option><option value="ark">火山方舟</option></select>
        <label htmlFor="model-api-key">API Key</label><div className="model-key-input"><input id="model-api-key" type={visible?'text':'password'} value={apiKey} onChange={event=>{setApiKey(event.target.value);setNotice('');setError('')}} placeholder="粘贴你自己的 API Key" autoComplete="off" spellCheck={false} autoCapitalize="none" disabled={testing}/><button className="icon-button" type="button" aria-label={visible?'隐藏 API Key':'显示 API Key'} onClick={()=>setVisible(value=>!value)}>{visible?<EyeOff size={18}/>:<Eye size={18}/>}</button></div>
        <label htmlFor="model-name">{provider==='ark'?'模型名称 / 接入点 ID':'模型名称'}</label><input id="model-name" value={model} onChange={event=>{setModel(event.target.value);setNotice('');setError('')}} placeholder={provider==='ark'?'填写已开通的文本模型或 ep-…':'填写账号支持的准确模型名称'} autoComplete="off" spellCheck={false} disabled={testing}/>
        <p className="model-config-note">密钥仅保存在当前标签页会话中，刷新页面仍保留，关闭标签页后需重新填写。调用时经本机服务转发至所选服务商，服务端不保存密钥，也不会使用项目原有的共享密钥。</p>
        <div className="model-config-actions"><button className="button primary" type="submit" disabled={testing||!apiKey.trim()||!model.trim()}>保存配置</button><button className="button secondary" type="button" disabled={testing||!apiKey.trim()||!model.trim()} onClick={()=>void test()}>{testing?<RefreshCw size={15} className="spinning"/>:<Check size={15}/>} {testing?'正在测试…':'测试连接'}</button><button className="text-button" type="button" onClick={clear} disabled={testing}><Trash2 size={14}/>清除配置</button>{testing&&<button type="button" className="text-button" onClick={()=>{request.current?.abort();setTesting(false)}}>取消等待</button>}</div>
      </form>
      {error&&<p className="form-error" role="alert">{error}</p>}{notice&&<p className="model-config-success" role="status"><Check size={16}/>{notice}</p>}
      <div className="form-note">保存不会调用模型。「测试连接」会发送一条简短测试消息，可能消耗少量额度。研究与测试均使用你所填服务商账户，不发送持仓股数、成本或盈亏。</div>
      <div className="source-links"><a href="https://platform.deepseek.com/api_keys" target="_blank" rel="noreferrer">获取 DeepSeek API Key ↗</a><a href="https://console.volcengine.com/ark/region:ark+cn-beijing/apiKey" target="_blank" rel="noreferrer">获取火山方舟 API Key ↗</a></div>
    </div>
  </section>
}
