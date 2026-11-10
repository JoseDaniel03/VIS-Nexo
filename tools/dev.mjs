import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { resolve, join, extname, sep } from 'node:path';
const root = resolve(import.meta.dirname, '../web');
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.jpg':'image/jpeg','.webp':'image/webp','.json':'application/json'};
const server = http.createServer(async(req,res)=>{
  try {
    const requestUrl = new URL(req.url ?? '/', 'http://localhost');
    const relative = decodeURIComponent(requestUrl.pathname).replace(/^\/+/, '') || 'index.html';
    const file = resolve(root, relative);
    if (!(file===root || file.startsWith(root+sep))) {res.writeHead(403).end();return;}
    const info = await stat(file);
    if (!info.isFile()) {res.writeHead(404).end();return;}
    const data=await readFile(file);
    res.writeHead(200,{'Content-Type':types[extname(file)]??'application/octet-stream','Cache-Control':'no-store','Content-Length':data.byteLength});res.end(data);
  } catch {res.writeHead(404).end('Not found');}
});
const port=Number(process.env.PORT||1420);
server.listen(port,'127.0.0.1',()=>console.log(`VSLauncher preview: http://127.0.0.1:${port}`));
