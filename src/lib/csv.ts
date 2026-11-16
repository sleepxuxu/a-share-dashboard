import type { HoldingInput } from '../types/holding'
import { normalizeCode } from './normalizeCode'
export function parseHoldingsCsv(text:string):HoldingInput[]{
  const rows:string[][]=[];let row:string[]=[],cell='',quoted=false
  const source=text.replace(/^\uFEFF/,'')
  for(let i=0;i<source.length;i++){
    const c=source[i]
    if(c==='"'){if(quoted&&source[i+1]==='"'){cell+='"';i++}else quoted=!quoted}
    else if(c===','&&!quoted){row.push(cell.trim());cell=''}
    else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&source[i+1]==='\n')i++;row.push(cell.trim());if(row.some(Boolean))rows.push(row);row=[];cell=''}
    else cell+=c
  }
  if(quoted)throw new Error('CSV 引号未闭合，请检查内容。')
  row.push(cell.trim());if(row.some(Boolean))rows.push(row)
  if(!rows.length)throw new Error('请先粘贴或选择 CSV 文件。')
  if(/代码|code/i.test(rows[0][0]))rows.shift()
  if(!rows.length)throw new Error('CSV 只有表头，请添加至少一条持仓。')
  if(rows.length>500)throw new Error('单次最多导入 500 条持仓。')
  const seen=new Set<string>()
  return rows.map((r,i)=>{
    const code=normalizeCode(r[0]??''),quantity=Number(r[2]),costPrice=Number(r[3])
    if(!code)throw new Error(`第 ${i+1} 条股票代码无效，仅支持沪深 A 股。`)
    if(!r[2]||!Number.isSafeInteger(quantity)||quantity<=0||quantity>1e10)throw new Error(`第 ${i+1} 条股数须为正整数，且不超过100亿。`)
    if(!r[3]||!Number.isFinite(costPrice)||costPrice<0||costPrice>1e7)throw new Error(`第 ${i+1} 条成本价无效。`)
    if(seen.has(code))throw new Error(`文件包含重复代码 ${code}，请先合并持仓。`)
    seen.add(code)
    if(r[5]&&!/^\d{4}-\d{2}-\d{2}$/.test(r[5]))throw new Error(`第 ${i+1} 条日期请使用 YYYY-MM-DD。`)
    return {code,name:r[1]||undefined,quantity,costPrice,industry:r[4]||undefined,buyDate:r[5]||undefined}
  })
}
