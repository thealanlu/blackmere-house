import {createServer} from 'node:http';
import {Readable} from 'node:stream';
import {sqlite} from './sqlite.mjs';
import worker from '../dist/server/index.js';

process.loadEnvFile && (()=>{try{process.loadEnvFile();}catch(e){if(e.code!=='ENOENT')throw e;}})();
const port=Number(process.env.PORT??8127);
const origin='http://127.0.0.1:'+port;
const env={...process.env,PLATFORM_AUTH:'0',DB:sqlite(process.env.BLACKMERE_DB??'blackmere.sqlite')};
const server=createServer(async(req,res)=>{
  try {
    const headers=new Headers();
    for(const [key,value] of Object.entries(req.headers)) {
      if(value!==undefined&&!key.startsWith('oai-authenticated-')&&!key.startsWith('cf-'))headers.set(key,value);
    }
    const hasBody=!['GET','HEAD'].includes(req.method);
    const url=new URL(req.url,origin);
    if(url.origin!==origin){res.writeHead(400).end();return;}
    const response=await worker.fetch(new Request(url,{method:req.method,headers,
      ...(hasBody?{body:Readable.toWeb(req),duplex:'half'}:{})}),env);
    res.statusCode=response.status;
    for(const [key,value] of response.headers)if(key!=='set-cookie')res.setHeader(key,value);
    if(response.headers.has('set-cookie'))res.setHeader('Set-Cookie',response.headers.getSetCookie());
    if(response.body)Readable.fromWeb(response.body).pipe(res);else res.end();
  }catch(error){console.error(error.message);if(!res.headersSent)res.writeHead(500);res.end('Local server error');}
});
server.listen(port,'127.0.0.1',()=>console.log('Blackmere House at '+origin));
