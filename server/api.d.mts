import type { IncomingMessage,ServerResponse } from 'node:http'
export function createApiHandler(env?:Record<string,string|undefined>):(req:IncomingMessage,res:ServerResponse)=>Promise<boolean>
