import type { IncomingMessage,ServerResponse } from 'node:http'
import type { CandidateStore } from './auction-candidates-file.mjs'
export function createApiHandler(env?:Record<string,string|undefined>,options?:{candidateStore?:CandidateStore}):(req:IncomingMessage,res:ServerResponse)=>Promise<boolean>
