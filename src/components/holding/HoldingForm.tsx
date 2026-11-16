import { useState, type FormEvent } from 'react'
import { Info, Plus } from 'lucide-react'
import { Modal } from '../layout/Modal'
import { useHoldingStore } from '../../stores/holdingStore'
import { normalizeCode } from '../../lib/normalizeCode'
import { INDUSTRIES,industryMap } from '../../constants/industryMap'
import type { HoldingInput } from '../../types/holding'
export function HoldingForm({holding,onClose}:{holding?:HoldingInput;onClose:()=>void}){
  const [code,setCode]=useState(holding?.code??''),[name,setName]=useState(holding?.name??'')
  const [quantity,setQuantity]=useState(holding?.quantity.toString()??''),[cost,setCost]=useState(holding?.costPrice.toString()??'')
  const [industry,setIndustry]=useState(holding?.industry??''),[buyDate,setBuyDate]=useState(holding?.buyDate??''),[error,setError]=useState('')
  function submit(e:FormEvent){
    e.preventDefault()
    const normalized=normalizeCode(code),q=Number(quantity),c=Number(cost)
    if(!normalized){setError('请输入有效的沪深 A 股代码，例如 600519、000858 或 SH600519。');return}
    if(!Number.isSafeInteger(q)||q<=0||q>1e10){setError('持仓数量必须为大于 0 的整数，且不超过 100 亿股。');return}
    if(cost.trim()===''||!Number.isFinite(c)||c<0||c>1e7){setError('成本价须为 0 至 10,000,000 之间的数字。');return}
    const store=useHoldingStore.getState()
    if(!holding&&store.holdings.some(h=>h.code===normalized)){setError('该股票已在持仓中，请在持仓表中编辑数量和成本。');return}
    const input:HoldingInput={code:normalized,name:name.trim()||undefined,quantity:q,costPrice:c,industry:industry||undefined,buyDate:buyDate||undefined}
    if(holding)store.update(holding.code,input);else store.add(input)
    onClose()
  }
  return <Modal title={holding?'编辑持仓':'添加持仓'} subtitle="记录你的投资，让每一份持仓都有据可循。" onClose={onClose}>
    <form onSubmit={submit} className="holding-form">
      <label>股票代码 <span>*</span><input autoFocus required value={code} onChange={e=>setCode(e.target.value)} readOnly={!!holding} placeholder="例如 600519 / SH600519" maxLength={8}/></label>
      <label>股票名称 <em>选填</em><input value={name} onChange={e=>setName(e.target.value)} placeholder="留空时使用行情名称" maxLength={30}/></label>
      <div className="form-row"><label>持仓数量（股）<span>*</span><input required type="number" min="1" step="1" value={quantity} onChange={e=>setQuantity(e.target.value)} placeholder="100"/></label><label>成本均价（元）<span>*</span><input required type="number" min="0" step="any" value={cost} onChange={e=>setCost(e.target.value)} placeholder="0.00"/></label></div>
      <div className="form-row"><label>所属行业 <em>选填</em><select value={industry} onChange={e=>setIndustry(e.target.value)}><option value="">自动识别（{industryMap[normalizeCode(code)??'']??'未覆盖则归其他'}）</option>{industry&&!INDUSTRIES.includes(industry)&&<option value={industry}>{industry}</option>}{INDUSTRIES.map(i=><option key={i}>{i}</option>)}</select></label><label>买入日期 <em>选填</em><input type="date" value={buyDate} onChange={e=>setBuyDate(e.target.value)}/></label></div>
      <div className="form-note"><Info size={16}/><span>持仓仅保存在当前浏览器。支持沪深 A 股，成本可为 0。</span></div>
      {error&&<p className="form-error" role="alert">{error}</p>}
      <div className="modal-actions"><button className="button secondary" type="button" onClick={onClose}>取消</button><button className="button primary" type="submit"><Plus size={16}/>{holding?'保存修改':'添加持仓'}</button></div>
    </form>
  </Modal>
}
