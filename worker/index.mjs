import { createFetchHandler } from '../server/fetch-handler.mjs'
import tape from '../.agents/skills/a-share-tape/SKILL.md'
import fundamentals from '../.agents/skills/a-share-fundamentals/SKILL.md'
import risk from '../.agents/skills/a-share-risk-review/SKILL.md'

// Bundle the whitelisted research sources; Workers do not read the local checkout.
export default {fetch:createFetchHandler({skillSources:{tape,fundamentals,risk}})}
