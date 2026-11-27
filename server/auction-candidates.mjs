const validDate = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value
const validCode = (value) => typeof value === 'string' && /^(SH6\d{5}|SZ[03]\d{5})$/.test(value)

export function candidateDaily(data, code, sourceDate) {
  if (data?.code !== code.slice(2) || !Array.isArray(data.klines)) return null
  const lines = data.klines.filter(line => typeof line === 'string' && line.startsWith(sourceDate + ','))
  if (lines.length !== 1) return null
  const parts = lines[0].split(',')
  if (!(Number(parts[2]) > 0) || !Number.isFinite(Number(parts[2])) || !(Number(parts[5]) > 0) || !Number.isSafeInteger(Number(parts[5]) * 100)) return null
  // Keep only the completed day's bar; never persist today's unfinished bar.
  return { code: code.slice(2), klines: lines }
}

export function validateCandidates(value, sourceDate = value?.sourceDate) {
  if (!validDate(sourceDate) || value?.schemaVersion !== 1 || value.sourceDate !== sourceDate ||
      !['closing', 'previous'].includes(value.origin) || !Number.isFinite(Date.parse(value.savedAt)) ||
      Date.parse(value.savedAt) < Date.parse(`${sourceDate}T15:00:00+08:00`) ||
      !Array.isArray(value.stocks) || !value.stocks.length || value.stocks.length > 500) return null
  const seen = new Set()
  for (const stock of value.stocks) {
    if (!validCode(stock.code) || typeof stock.name !== 'string' || !stock.name.trim() || stock.name.length > 80 || seen.has(stock.code)) return null
    seen.add(stock.code)
    if (stock.daily !== null && !candidateDaily(stock.daily, stock.code, sourceDate)) return null
  }
  return value
}

export function mergeCandidates(previous, incoming) {
  if (!validateCandidates(incoming)) throw new Error('候选池日期或格式无效')
  if (!validateCandidates(previous, incoming.sourceDate)) return incoming
  const [older, newer] = Date.parse(previous.savedAt) > Date.parse(incoming.savedAt) ? [incoming, previous] : [previous, incoming]
  const oldStocks = new Map(older.stocks.map(stock => [stock.code, stock]))
  return { ...newer, stocks: newer.stocks.map(stock => ({ ...stock, daily: stock.daily ?? oldStocks.get(stock.code)?.daily ?? null })) }
}

export function createRemoteCandidateStore(namespace) {
  const stub = () => namespace.get(namespace.idFromName('auction-candidates-v1'))
  return {
    async load(sourceDate) {
      const response = await stub().fetch(`https://auction-store/${sourceDate}`)
      if (!response.ok) throw new Error('候选池存储读取失败')
      return validateCandidates(await response.json(), sourceDate)
    },
    async save(value) {
      const response = await stub().fetch(`https://auction-store/${value.sourceDate}`, { method: 'PUT', body: JSON.stringify(value) })
      if (!response.ok) throw new Error('候选池存储写入失败')
    },
  }
}
