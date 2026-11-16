import { industryMap } from '../constants/industryMap'
import type { HoldingInput } from '../types/holding'
export const getIndustry = (h: HoldingInput) => h.industry || industryMap[h.code] || '其他'
