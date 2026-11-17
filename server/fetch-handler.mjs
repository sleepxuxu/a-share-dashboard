import { createApiHandler } from './api.mjs'

// Bridge the existing Node middleware to the Workers Fetch API.
export function createFetchHandler(options={}){
  const handleApi=createApiHandler({},options)
  return async function handleFetch(request,env){
    const url=new URL(request.url)
    // Keep all API requests out of the static assets / SPA fallback.
    if(url.pathname!=='/api'&&!url.pathname.startsWith('/api/'))return env.ASSETS.fetch(request)
    const req={
      url:url.pathname+url.search,method:request.method,
      headers:{...Object.fromEntries(request.headers),host:url.host},
      async *[Symbol.asyncIterator](){
        if(!request.body)return
        const reader=request.body.getReader(),decoder=new TextDecoder()
        try{
          while(true){
            const {done,value}=await reader.read()
            if(done)break
            yield decoder.decode(value,{stream:true})
          }
          const tail=decoder.decode()
          if(tail)yield tail
        }finally{reader.releaseLock()}
      },
    }
    let status=200,headers={},body=''
    const res={
      headersSent:false,
      writeHead(code,values){status=code;headers=values;this.headersSent=true},
      end(value=''){body=value},
    }
    const handled=await handleApi(req,res)
    if(!handled)return Response.json({error:'接口不存在'},{status:404,headers:{'Cache-Control':'no-store'}})
    return new Response(request.method==='HEAD'?null:body,{status,headers})
  }
}
