import type { AiAnalysis,AiConfig,AiProvider,Fundamentals } from '../types/fundamentals'
import { readModelCredentials } from './modelCredentials'
import type { ResearchSkill,ResearchSkillId,SkillResearch } from '../types/research'

async function json<T>(url:string,options?:RequestInit):Promise<T>{
  const response=await fetch(url,options)
  if(!response.headers.get('content-type')?.includes('application/json'))throw new Error('研究接口返回了非 JSON 内容，请检查部署是否包含后端 API，而不是只发布了静态页面。')
  const data=await response.json()
  if(!response.ok)throw new Error(data.error||'请求未能完成，请稍后重试。')
  return data as T
}
export function fetchFundamentals(code:string,signal:AbortSignal,force=false){
  return json<Fundamentals>(`/api/fundamentals?code=${encodeURIComponent(code)}${force?'&refresh=1':''}`,{signal})
}
export async function fetchAiConfig():Promise<AiConfig>{
  const config=await json<AiConfig>('/api/ai/config')
  return {providers:config.providers.map(item=>{const saved=readModelCredentials(item.id);return {...item,model:saved?.model||item.model,configured:!!saved}})}
}
export const testModelConnection=(provider:AiProvider,credentials:{apiKey:string;model:string},signal:AbortSignal)=>
  json<{message:string}>('/api/ai/test',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({provider,credentials}),signal})
export const fetchResearchSkills=(signal:AbortSignal)=>json<{skills:ResearchSkill[]}>('/api/research/skills',{signal})
export const analyzeWithSkill=(code:string,skill:ResearchSkillId,mode:'checks'|'ai',provider:AiProvider,signal:AbortSignal)=>
  json<SkillResearch>('/api/research/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,skill,mode,...(mode==='ai'?{provider,credentials:readModelCredentials(provider)}:{})}),signal})
export function analyzeFundamentals(code:string,provider:AiProvider,signal:AbortSignal){
  return json<AiAnalysis>('/api/ai/analyze',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({code,provider,credentials:readModelCredentials(provider)}),signal})
}
