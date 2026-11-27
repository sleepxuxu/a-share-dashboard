import { mergeCandidates, validateCandidates } from '../server/auction-candidates.mjs'

// A SQLite-backed Durable Object survives Worker isolate restarts.
export class AuctionCandidateStore {
  constructor(state) { this.state = state }
  async fetch(request) {
    const date = new URL(request.url).pathname.slice(1)
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return new Response('Invalid date', { status: 400 })
    if (request.method === 'GET') return Response.json(await this.state.storage.get(date) ?? null)
    if (request.method !== 'PUT') return new Response('Method not allowed', { status: 405 })
    let value
    try { value = validateCandidates(await request.json(), date) } catch {}
    if (!value) return new Response('Invalid candidates', { status: 400 })
    await this.state.storage.transaction(async storage => {
      await storage.put(date, mergeCandidates(await storage.get(date), value))
      const dates = [...(await storage.list()).keys()].sort().reverse()
      for (const oldDate of dates.slice(30)) await storage.delete(oldDate)
    })
    return new Response(null, { status: 204 })
  }
}
