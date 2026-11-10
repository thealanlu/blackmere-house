import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';

export async function buildPwa(output) {
  const files=['index.html','style.css','multiplayer.css','adaptive.css','blackmere.webmanifest'];
  for(const folder of ['src','vendor','assets']) {
    const items=await readdir(new URL(folder+'/',output),{withFileTypes:true});
    for(const item of items)if(item.isFile()&&/\.(?:js|png|webp|jpg)$/.test(item.name))files.push(folder+'/'+item.name);
  }
  files.sort();
  const hash=createHash('sha256').update(await readFile(new URL(import.meta.url)));
  for(const file of files)hash.update(file).update(await readFile(new URL(file,output)));
  const worker=`
const scope=new URL(self.registration.scope);
const prefix='blackmere:'+scope.pathname+':';
const name=prefix+${JSON.stringify(hash.digest('hex').slice(0,20))};
const files=${JSON.stringify(files)};
const paths=new Set(files.map(file=>new URL(file,scope).pathname));
const home=new URL('index.html',scope);
self.addEventListener('install',event=>{
  event.waitUntil((async()=>{
    const cache=await caches.open(name);
    for(let i=0;i<files.length;i+=6){
      await cache.addAll(files.slice(i,i+6).map(file=>new Request(new URL(file,scope),{cache:'reload'})));
    }
  })());
});
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    await Promise.all((await caches.keys()).filter(key=>key.startsWith(prefix)&&key!==name).map(key=>caches.delete(key)));
    await self.clients.claim();
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==scope.origin)return;
  const navigation=request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===home.pathname);
  if(!navigation&&!paths.has(url.pathname))return;
  event.respondWith((async()=>{
    const key=navigation?home:new URL(url.pathname,scope);
    const cached=await (await caches.open(name)).match(key);
    return cached??fetch(request);
  })());
});
`;
  await writeFile(new URL('sw.js',output),worker.trimStart());
}
