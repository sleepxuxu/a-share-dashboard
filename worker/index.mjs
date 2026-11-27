import { createFetchHandler } from '../server/fetch-handler.mjs'
import tape from '../.agents/skills/a-share-tape/SKILL.md'
import fundamentals from '../.agents/skills/a-share-fundamentals/SKILL.md'
import risk from '../.agents/skills/a-share-risk-review/SKILL.md'
import { createRemoteCandidateStore } from '../server/auction-candidates.mjs'
export { AuctionCandidateStore } from './auction-store.mjs'

// Bundle the whitelisted research sources; Workers do not read the local checkout.
const handlers = new WeakMap()
export default {
  fetch(request, env) {
    const key = env.AUCTION_CANDIDATES ?? env
    let handle = handlers.get(key)
    if (!handle) {
      handle = createFetchHandler({ skillSources: { tape, fundamentals, risk },
        candidateStore: env.AUCTION_CANDIDATES ? createRemoteCandidateStore(env.AUCTION_CANDIDATES) : null })
      handlers.set(key, handle)
    }
    return handle(request, env)
  },
}
