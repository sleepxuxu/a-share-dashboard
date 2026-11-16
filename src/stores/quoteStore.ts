import { create } from 'zustand'
import type { Quote } from '../types/quote'
interface QuoteState { quotes:Map<string,Quote>; updatedAt:Record<string,number>; staleCodes:string[]; loading:boolean; error:string|null; lastUpdated:number|null }
export const useQuoteStore=create<QuoteState>(()=>({quotes:new Map(),updatedAt:{},staleCodes:[],loading:false,error:null,lastUpdated:null}))
