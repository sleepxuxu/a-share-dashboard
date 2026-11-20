import type { TailSnapshot } from '../types/tailSelection'

export const tailReviews = [
  { title: '成交量温和放大', detail: '检查成交量序列呈阶梯式递增，排除忽高忽低、脉冲放量。', step: '06' },
  { title: 'K 线上方无明显压力', detail: '核实均线多头排列、支撑清晰，排除高位长上影；偏离 MA5 不超过 8%。', step: '07' },
  { title: '分时强于大盘', detail: '核对全天分时与均价线，排除曾长时间跌破均价线的股票。', step: '08' },
  { title: '尾盘触发已确认', detail: '核实 14:30 后创新高与推升成交、突破后回踩不破并勾头，或突破短期前高；排除急拉超过 5%。', step: '09' },
  { title: '财务与公告风险已核查', detail: '查看同口径财报、亏损、质押及减持、解禁等公告原文；资料缺失不能视作无风险。', step: '+' },
] as const
export type ReviewValue = 'pending' | 'pass' | 'fail'
export type Trend = 'pending' | 'rebound' | 'rising' | 'strong' | 'falling'
export function tailPhase(time: number) {
  const parts = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Shanghai', hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23' }).formatToParts(time)
  const part = (key: string) => parts.find(item => item.type === key)?.value || ''
  const minute = Number(part('hour')) * 60 + Number(part('minute'))
  if (['Sat', 'Sun'].includes(part('weekday'))) return { stage: -1, title: '周末休市', detail: '保留快照用于复盘，等待下一个交易日。' }
  if (minute < 870) return { stage: 0, title: '等待 14:30 筛选', detail: '当前仅供预览，尾盘条件尚未形成。' }
  if (minute < 890) return { stage: 1, title: '筛选与复核窗口', detail: '14:30 后复核量价与分时，等待尾盘触发。' }
  if (minute < 898) return { stage: 2, title: '尾盘观察窗口', detail: '14:50–14:58；14:55 后突击拉升需排除，不追急拉。' }
  return { stage: 3, title: '今日窗口已结束', detail: '14:58 后停止新增，已持仓按次日退出纪律复核。' }
}
export function reviewComplete(values: ReviewValue[]) { return values.length === tailReviews.length && values.every(value => value === 'pass') }
export function tailBoard(code: string) {
  if (/^SZ30\d{4}$/.test(code)) return '创业板'
  if (/^SH68\d{4}$/.test(code)) return '科创板'
  return '主板'
}
export function makeTailDemo(market: 'main' | 'all' = 'main'): TailSnapshot {
  const asOf = '2026-11-19T06:45:00.000Z'
  return { asOf, fetchedAt: asOf, marketDate: '2026-11-19', market, isToday: false, stale: true, demo: true, scannedCount: 286, total: 5100, pages: 3,
    scope: '虚构演示样本，用于体验筛选和复核交互，不代表真实股票与市场行情。', warnings: ['演示模式：全部名称、价格及筛选结果均为虚构，不用于实际交易。'],
    source: { name: '虚构演示数据', url: '' }, stages: [286, 8, 6, 4, 3],
    indices: [{ code: '000001', name: '上证指数', price: 3368.42, change: .62, asOf }, { code: '399001', name: '深证成指', price: 10826.17, change: .89, asOf }, { code: '399006', name: '创业板指', price: 2258.36, change: 1.12, asOf }],
    candidates: Array.from({ length: 8 }, (_, i) => ({ code: `SZ00200${i + 1}`, name: ['示例智造', '示例电子', '示例新材', '示例电气', '示例能源', '示例精工', '示例科技', '示例装备'][i], price: 16.82 + i * 2.3, change: 3.26 + i * .21, amount: (6.3 + i) * 1e8, turnover: i < 4 ? 5.8 + i * .7 : 3.2, volumeRatio: i < 6 ? 2.36 + i * .19 : .8, floatCap: i < 3 ? (86 + i * 21) * 1e8 : 240e8, high: 17.1 + i * 2.3, low: 15.9 + i * 2.3, industry: ['专用设备', '电子元件', '新材料'][i % 3], asOf, gates: [true, i < 6, i < 4, i < 3] })),
  }
}
