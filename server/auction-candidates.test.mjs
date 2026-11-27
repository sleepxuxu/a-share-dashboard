import { test } from 'node:test'
import assert from 'node:assert/strict'
import { writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomUUID } from 'node:crypto'
import { createFileCandidateStore } from './auction-candidates-file.mjs'
import { candidateDaily, validateCandidates, createRemoteCandidateStore } from './auction-candidates.mjs'
import { AuctionCandidateStore } from '../worker/auction-store.mjs'

const bar = { code: '002861', klines: ['2026-11-27,10,11,11,10,10000,11000000'] }
const bundle = () => ({ schemaVersion: 1, sourceDate: '2026-11-27', origin: 'closing', savedAt: '2026-11-27T15:10:00+08:00', stocks: [{ code: 'SZ002861', name: '测试股票', daily: bar }] })

test('候选池拒绝盘中准备、错误日期、重复代码与错误日线', () => {
  assert.ok(validateCandidates(bundle()))
  assert.equal(validateCandidates(bundle(), '2026-11-26'), null)
  assert.equal(validateCandidates({ ...bundle(), sourceDate: '2026-02-30' }), null)
  assert.equal(validateCandidates({ ...bundle(), savedAt: '2026-11-27T14:59:59+08:00' }), null)
  assert.equal(validateCandidates({ ...bundle(), stocks: [...bundle().stocks, ...bundle().stocks] }), null)
  assert.equal(validateCandidates({ ...bundle(), stocks: [{ ...bundle().stocks[0], daily: { ...bar, code: '000001' } }] }), null)
  assert.equal(candidateDaily(bar, 'SZ002861', '2026-11-26'), null)
  assert.equal(candidateDaily({ ...bar, klines: [...bar.klines, ...bar.klines] }, 'SZ002861', '2026-11-27'), null)
})

test('本地文件跨实例复用、并发保存合并完整资料，损坏文件允许重建', async () => {
  const file = join(tmpdir(), `auction-candidates-${randomUUID()}.json`)
  try {
    const store = createFileCandidateStore(file)
    assert.equal(await store.load('2026-11-27'), null)
    const partial = { ...bundle(), savedAt: '2026-11-27T15:11:00+08:00', stocks: [{ ...bundle().stocks[0], daily: null }] }
    await Promise.all([store.save(bundle()), store.save(partial)])
    const restarted = createFileCandidateStore(file)
    const saved = await restarted.load('2026-11-27')
    assert.deepEqual(saved.stocks[0].daily, bar)
    assert.equal(saved.savedAt, partial.savedAt)
    assert.equal(await restarted.load('2026-11-26'), null)
    await assert.rejects(restarted.save({ ...bundle(), sourceDate: '../invalid' }), /无效/)
    await writeFile(file, '{broken', 'utf8')
    assert.equal(await createFileCandidateStore(file).load('2026-11-27'), null)
    await restarted.save(bundle())
    assert.deepEqual(await restarted.load('2026-11-27'), bundle())
  } finally { await rm(file, { force: true }) }
})

test('Worker 持久化绑定跨对象实例保留资料，拒绝不符数据并保留最近30日', async () => {
  const values = new Map()
  const storage = {
    get: async key => values.get(key), put: async (key, value) => { values.set(key, value) },
    delete: async key => values.delete(key), list: async () => new Map(values),
    transaction: async fn => fn(storage),
  }
  let object = new AuctionCandidateStore({ storage })
  const store = createRemoteCandidateStore({ idFromName: name => name, get: () => ({ fetch: (url, init) => object.fetch(new Request(url, init)) }) })
  await store.save(bundle())
  object = new AuctionCandidateStore({ storage })
  assert.deepEqual(await store.load('2026-11-27'), bundle())
  assert.equal(await store.load('2026-11-26'), null)
  const bad = await object.fetch(new Request('https://store/2026-11-26', { method: 'PUT', body: JSON.stringify(bundle()) }))
  assert.equal(bad.status, 400)
  for (let i = 1; i <= 31; i++) values.set(`2026-10-${String(i).padStart(2, '0')}`, bundle())
  await store.save(bundle())
  assert.equal(values.size, 30)
  assert.ok(values.has('2026-11-27'))
})
