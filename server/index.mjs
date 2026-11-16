import { createServer } from 'node:http'
import { createReadStream,existsSync,statSync } from 'node:fs'
import { resolve,extname,sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createApiHandler } from './api.mjs'

const root=resolve(fileURLToPath(new URL('../dist/',import.meta.url)))
const handler=createApiHandler()
const types={'.html':'text/html; charset=utf-8','.js':'application/javascript','.css':'text/css','.svg':'image/svg+xml','.png':'image/png','.ico':'image/x-icon'}
const server=createServer(async(req,res)=>{
  if(await handler(req,res))return
  if(req.method!=='GET'&&req.method!=='HEAD'){res.writeHead(405);res.end();return}
  try{
    const path=resolve(root,'.'+decodeURIComponent(new URL(req.url,'http://localhost').pathname))
    if(path!==root&&!path.startsWith(root+sep)){res.writeHead(403);res.end();return}
    const file=existsSync(path)&&statSync(path).isFile()?path:resolve(root,'index.html')
    if(!existsSync(file)){res.writeHead(503);res.end('Please run npm run build first.');return}
    res.writeHead(200,{'Content-Type':types[extname(file)]||'application/octet-stream','X-Content-Type-Options':'nosniff'})
    if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res)
  }catch{res.writeHead(400);res.end()}
})
server.listen(Number(process.env.PORT)||5180,'127.0.0.1',()=>console.log(`股见：http://127.0.0.1:${Number(process.env.PORT)||5180}`))
