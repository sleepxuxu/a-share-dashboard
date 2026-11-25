import { describe, expect, it } from 'vitest'
import { auctionDemo, auctionTemplate, parseAuctionDataset, screenAuction } from './auction'

const base = auctionDemo().records[0]
const parse = (record: Record<string, unknown> = {}, metadata: Record<string, unknown> = {}) => parseAuctionDataset(JSON.stringify({ ...auctionTemplate(), ...metadata, records: [{ ...base, ...record }] }))

describe('竞价四项条件', () => {
  it('最低竞价额独立要求1000万元，少1元排除、相等保留，量占比不能绕过', () => {
    expect(screenAuction({ ...base, auctionAmount: 9_999_999 }).status).toBe('rejected')
    expect(screenAuction({ ...base, auctionAmount: 10_000_000 }).status).toBe('matched')
    expect(screenAuction({ ...base, auctionAmount: 10_000_001 }).status).toBe('matched')
    expect(screenAuction({ ...base, auctionVolume: 4_000_000 }).status).toBe('matched')
    const missing = screenAuction({ ...base, auctionAmount: null })
    expect(missing.checks[3].status).toBe('pass')
    expect(missing.checks[6].status).toBe('missing')
    expect(missing.status).toBe('pending')
    const imported = parse({ auctionAmount: 9_999_999 }).records[0]
    expect(screenAuction(imported).status).toBe('rejected')
  })
  it('开竞价00、01、02秒任一有效价格等于涨停价即可，均缺失时待核验', () => {
    for (const field of ['price091500', 'price091501', 'price091502']) {
      const record = { ...base, price091500: null, price091501: null, price091502: null, [field]: 11 }
      expect(screenAuction(record).status, field).toBe('matched')
      expect(screenAuction(record).checks[1].detail).toContain('11.00 元')
      expect(screenAuction({ ...record, [field]: 10.99 }).checks[1].status).toBe('fail')
      expect(screenAuction({ ...record, limitUpPrice: null }).checks[1].status).toBe('missing')
    }
    expect(screenAuction({ ...base, price091500: 10.99, price091501: 11, price091502: 10.98 }).status).toBe('matched')
    expect(screenAuction({ ...base, price091500: null, price091501: null, price091502: null }).status).toBe('pending')
  })
  it('00 或 02 秒竞价价可分别与 57、58、59 秒任一有效价格比较', () => {
    for (const auctionTime of ['09:25:00', '09:25:02']) {
      for (const field of ['price092457', 'price092458', 'price092459']) {
        const record = { ...base, auctionTime, price092457: null, price092458: null, price092459: null, [field]: 10.3 }
        expect(screenAuction(record).status, `${auctionTime} / ${field}`).toBe('matched')
        expect(screenAuction({ ...record, [field]: 10.5 }).checks[2].status).toBe('fail')
        expect(screenAuction({ ...record, [field]: 10.6 }).checks[2].status).toBe('fail')
      }
    }
    expect(screenAuction({ ...base, price092457: 10.6, price092458: 10.5, price092459: 10.3 }).status).toBe('matched')
    expect(screenAuction({ ...base, price092457: null, price092458: null, price092459: null }).checks[2].status).toBe('missing')
    expect(screenAuction({ ...base, price092500: null, price092458: 10.3 }).checks[2].status).toBe('missing')
  })
  it('量占比或成交额满足任一即可入选，四大项须全部通过', () => {
    expect(auctionDemo().records.map(record => screenAuction(record).status)).toEqual(['matched', 'matched', 'rejected', 'rejected', 'pending', 'pending'])
    expect(screenAuction({ ...base, previousClose: 9.99 }).checks[0].status).toBe('fail')
    expect(screenAuction({ ...base, price091500: 10.99 }).checks[1].status).toBe('fail')
  })
  it('严格处理 3% 和 1 亿元的相等边界', () => {
    const boundary = { ...base, previousVolume: 1_000_000_000, auctionVolume: 30_000_000, auctionAmount: 100_000_000 }
    expect(screenAuction(boundary).status).toBe('rejected')
    expect(screenAuction({ ...boundary, auctionVolume: 30_000_001 }).status).toBe('matched')
    expect(screenAuction({ ...boundary, auctionAmount: 100_000_000.01 }).status).toBe('matched')
    expect(screenAuction({ ...base, price092500: base.price092457 }).checks[2].status).toBe('fail')
    expect(screenAuction({ ...base, price092500: 10.29 }).checks[2].status).toBe('fail')
  })
  it('缺失值不当成 0；OR 已通过时另一分支可以缺失', () => {
    expect(screenAuction({ ...base, price092457: null }).status).toBe('pending')
    expect(screenAuction({ ...base, auctionVolume: null, auctionAmount: null }).status).toBe('pending')
    expect(screenAuction({ ...base, auctionVolume: 0, auctionAmount: null }).status).toBe('pending')
    expect(screenAuction({ ...base, auctionVolume: 0, auctionAmount: 0 }).status).toBe('rejected')
    expect(screenAuction({ ...base, auctionAmount: null }).status).toBe('pending')
    expect(screenAuction({ ...base, auctionVolume: null, auctionAmount: 100_000_001 }).status).toBe('matched')
    expect(screenAuction({ ...base, previousVolume: 0, auctionAmount: 0 }).status).toBe('rejected')
    expect(screenAuction({ ...base, previousClose: 9, price092457: null }).status).toBe('rejected')
  })
  it('阈值调整会改变筛选结果，无效阈值拒绝执行', () => {
    expect(screenAuction(base, { volumePercent: 5, amountYuan: 1.1e8 }).status).toBe('rejected')
    expect(() => screenAuction(base, { volumePercent: 0, amountYuan: 1e8 })).toThrow()
  })
  it('创业板 300/301、ST/*ST/S*ST 大小写及除权前缀均不入选', () => {
    for (const code of ['SZ300001', 'SZ301001']) {
      const result = screenAuction({ ...base, code })
      expect(result.status).toBe('rejected')
      expect(result.checks[4].detail).toContain('创业板')
    }
    for (const name of ['ST测试', '*ST测试', 'st测试', 'ＳＴ测试', 'S*ST测试', 'SST测试', 'XD*ST测试', 'DRST测试', ' ST 测试 ']) {
      expect(screenAuction({ ...base, name }).status, name).toBe('rejected')
    }
    expect(screenAuction({ ...base, name: 'BEST测试' }).status).toBe('matched')
    expect(screenAuction({ ...base, code: 'SZ002001' }).status).toBe('matched')
  })
  it('尾段抬价但最终仍低开时排除；平开允许，缺昨收或最终价时待核验', () => {
    const lowOpen = { ...base, price092457: 9.98, price092500: 9.99 }
    const rejected = screenAuction(lowOpen)
    expect(rejected.checks[2].status).toBe('pass')
    expect(rejected.checks[5].status).toBe('fail')
    expect(rejected.auctionChangePercent).toBeCloseTo(-0.1)
    expect(rejected.status).toBe('rejected')
    const flat = screenAuction({ ...lowOpen, price092500: 10 })
    expect(flat.status).toBe('matched')
    expect(flat.auctionChangePercent).toBe(0)
    const missing = screenAuction({ ...base, previousClose: null, previousLimitUpVerified: true })
    expect(missing.checks[5].status).toBe('missing')
    expect(missing.status).toBe('pending')
    expect(screenAuction({ ...base, price092500: null }).checks[5].status).toBe('missing')
  })
})

describe('竞价快照校验', () => {
  it('保留01、02秒的精确字段并兼容旧快照，不把它们冒充00秒', () => {
    const record = parse({ price091500: null, price091501: 11, price091502: 10.99 }).records[0]
    expect(record).toMatchObject({ price091500: null, price091501: 11, price091502: 10.99 })
    expect(screenAuction(record).status).toBe('matched')
    expect(parseAuctionDataset(JSON.stringify({ ...auctionTemplate(), records: [record] })).records[0]).toEqual(record)
    expect(parse({ price091501: undefined, price091502: undefined }).records[0]).toMatchObject({ price091501: null, price091502: null })
    for (const field of ['price091501', 'price091502']) {
      expect(() => parse({ [field]: 10.991 })).toThrow('两位小数')
      expect(() => parse({ [field]: 12 })).toThrow('高于对应涨停价')
    }
  })
  it('新增比较时点导入导出保留，旧文件兼容且同样校验价格精度与涨停上限', () => {
    const record = parse({ price092457: null, price092458: 10.3, price092459: 10.4, auctionTime: '09:25:02' }).records[0]
    expect(record).toMatchObject({ price092458: 10.3, price092459: 10.4, auctionTime: '09:25:02' })
    expect(screenAuction(record).status).toBe('matched')
    expect(parseAuctionDataset(JSON.stringify({ ...auctionTemplate(), records: [record] })).records[0]).toEqual(record)
    expect(parse().records[0]).toMatchObject({ price092458: null, price092459: null })
    for (const field of ['price092458', 'price092459']) {
      expect(() => parse({ [field]: 10.301 })).toThrow('两位小数')
      expect(() => parse({ [field]: 12 })).toThrow('高于对应涨停价')
    }
  })
  it('导入导出保留最终竞价实际采样时间，核验显示该时点并拒绝窗口外时间', () => {
    const record = parse({ auctionTime: '09:25:05' }).records[0]
    expect(record.auctionTime).toBe('09:25:05')
    expect(screenAuction(record).checks[2].detail).toContain('09:25:05 10.50 元')
    expect(parseAuctionDataset(JSON.stringify({ ...auctionTemplate(), records: [record] })).records[0].auctionTime).toBe('09:25:05')
    for (const auctionTime of ['09:24:59', '09:25:06', '09:30:00', 92505]) expect(() => parse({ auctionTime })).toThrow('auctionTime')
  })
  it('规范代码、保留零成交和缺失值，不按 10% 计算涨停价', () => {
    expect(parse({ code: '000001', previousClose: 12, previousLimitUpPrice: 12, auctionAmount: 0, auctionVolume: 0, price092457: null }).records[0])
      .toMatchObject({ code: 'SZ000001', previousClose: 12, auctionAmount: 0, auctionVolume: 0, price092457: null })
    expect(parse({ price091500: undefined }).records[0].price091500).toBeNull()
    expect(parseAuctionDataset('\uFEFF' + JSON.stringify(auctionDemo())).demo).toBe(true)
  })
  it('拒绝错误日期、重复代码、错单位、非法价格与超过涨停的价格', () => {
    expect(() => parse({}, { tradeDate: '2026-02-30' })).toThrow('交易日期')
    expect(() => parse({}, { previousTradeDate: '2026-11-18' })).toThrow('前一交易日')
    expect(() => parse({ code: 'BJ830001' })).toThrow('沪深')
    expect(() => parse({ auctionVolume: 1.5 })).toThrow('整数股数')
    expect(() => parse({ auctionVolume: '1000000' })).toThrow('非负数')
    expect(() => parse({ price091500: 11.001 })).toThrow('两位小数')
    expect(() => parse({ price092500: 12 })).toThrow('高于对应涨停价')
    expect(() => parse({ price091500: 0 })).toThrow('大于 0')
    expect(() => parseAuctionDataset(JSON.stringify({ ...auctionDemo(), records: [base, base] }))).toThrow('重复')
    expect(() => parseAuctionDataset(JSON.stringify({ ...auctionDemo(), records: [] }))).toThrow('1–6000')
    expect(() => parseAuctionDataset('not json')).toThrow('JSON 格式')
  })
})
