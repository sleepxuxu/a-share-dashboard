import type { AiProvider } from '../types/fundamentals'
export interface ModelCredentials {apiKey:string;model:string}
const storageKey='gujian-model-credentials'
const valid=(value:unknown):value is ModelCredentials=>!!value&&typeof value==='object'&&'apiKey' in value&&typeof value.apiKey==='string'&&/^[\x21-\x7e]{1,512}$/.test(value.apiKey)&&'model' in value&&typeof value.model==='string'&&/^[a-zA-Z0-9._:/-]{1,160}$/.test(value.model)
export function readModelCredentials(provider:AiProvider):ModelCredentials|null{
  try{const saved=JSON.parse(sessionStorage.getItem(storageKey)||'{}');return valid(saved?.[provider])?saved[provider]:null}catch{return null}
}
export function saveModelCredentials(provider:AiProvider,value:ModelCredentials){
  const cleaned={apiKey:value.apiKey.trim(),model:value.model.trim()}
  if(!valid(cleaned))throw new Error('请填写有效的 API Key 和模型名称，不能包含空格。')
  const saved:Record<string,ModelCredentials>={}
  try{for(const id of ['deepseek','ark'] as const){const item=readModelCredentials(id);if(item)saved[id]=item}saved[provider]=cleaned;sessionStorage.setItem(storageKey,JSON.stringify(saved))}
  catch{throw new Error('浏览器禁止会话存储，无法保存密钥。请允许当前站点存储后重试。')}
}
export function clearModelCredentials(provider:AiProvider){
  const saved:Record<string,ModelCredentials>={}
  for(const id of ['deepseek','ark'] as const){const item=readModelCredentials(id);if(id!==provider&&item)saved[id]=item}
  try{if(Object.keys(saved).length)sessionStorage.setItem(storageKey,JSON.stringify(saved));else sessionStorage.removeItem(storageKey)}
  catch{throw new Error('浏览器会话存储不可用，清除失败。')}
}
