import { useState } from 'react'
import { Upload, Check } from 'lucide-react'
import { Modal } from '../layout/Modal'
import { parseHoldingsCsv } from '../../lib/csv'
import { useHoldingStore } from '../../stores/holdingStore'
export function HoldingImport({onClose,onImported}:{onClose:()=>void;onImported:()=>void}){
  const [text,setText]=useState(''),[error,setError]=useState(''),[preview,setPreview]=useState<ReturnType<typeof parseHoldingsCsv>|null>(null)
  const existing=useHoldingStore(s=>s.holdings)
  const duplicates=preview?.filter(h=>existing.some(x=>x.code===h.code)).length??0
  return <Modal title="导入持仓" subtitle="粘贴 CSV 内容，或选择之前导出的持仓文件。" onClose={onClose} wide>
    <div className="import-content"><label className="file-picker"><Upload size={16}/>选择 CSV 文件<input type="file" accept=".csv,text/csv" onChange={async e=>{const file=e.target.files?.[0];if(file){if(file.size>1024*1024){setError('文件不能超过 1 MB。');return}setText(await file.text());setPreview(null);setError('')}}}/></label>
    <label className="csv-label">CSV 内容<textarea value={text} onChange={e=>{setText(e.target.value);setPreview(null);setError('')}} placeholder={'代码,名称,数量,成本价,行业,买入日期\n600519,贵州茅台,100,1420,食品饮料,2026-11-01'}/></label>
    <p className="form-note">列顺序：代码、名称、数量、成本价、行业、买入日期。名称、行业和日期可留空。新增记录会合并至现有持仓。</p>
    {error&&<p className="form-error" role="alert">{error}</p>}
    {preview&&<div className="import-preview"><Check size={18}/><div><strong>已校验 {preview.length} 条持仓</strong><p>{duplicates?`${duplicates} 条与现有代码重复，确认后将覆盖对应记录。`:'代码、数量和成本格式正确，可以导入。'}</p><span>{preview.slice(0,5).map(h=>h.name??h.code).join(' · ')}{preview.length>5?' …':''}</span></div></div>}
    <div className="modal-actions"><button className="button secondary" onClick={onClose}>取消</button>{preview?<button className="button primary" onClick={()=>{const current=useHoldingStore.getState().holdings;useHoldingStore.setState({holdings:[...new Map([...current,...preview].map(h=>[h.code,h])).values()]});onImported();onClose()}}>确认导入 {preview.length} 条</button>:<button className="button primary" onClick={()=>{try{setPreview(parseHoldingsCsv(text));setError('')}catch(e){setError(e instanceof Error?e.message:'导入内容格式错误')}}}>校验并预览</button>}</div></div>
  </Modal>
}
