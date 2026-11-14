const scope=new URL(self.registration.scope);
const prefix='blackmere:'+scope.pathname+':';
const cacheName=prefix+manifest.version;
const entries=new Map(manifest.files.map(file=>[new URL(file.path,scope).pathname,file]));
const home=entries.get(new URL('index.html',scope).pathname);
const key=file=>new URL(file.path,scope).href;
const toHex=bytes=>Array.from(new Uint8Array(bytes),byte=>byte.toString(16).padStart(2,'0')).join('');
const fetchAsset=file=>fetch(key(file),{cache:'reload',credentials:'omit',redirect:'error'});

async function intact(response,file) {
  if(!response?.ok)return false;
  try {
    const bytes=await response.arrayBuffer();
    return bytes.byteLength===file.size&&toHex(await crypto.subtle.digest('SHA-256',bytes))===file.sha256;
  }catch{return false;}
}

const observers=new Set();
let downloading;
function download(observe) {
  if(observe)observers.add(observe);
  downloading??=(async()=>{
    const cache=await caches.open(cacheName);
    let remaining=manifest.total;
    for(const file of manifest.files) {
      if(!await intact(await cache.match(key(file)),file)) {
        const response=await fetchAsset(file);
        if(!await intact(response.clone(),file))throw new Error('A game file failed verification. Try the download again.');
        await cache.put(key(file),response);
      }
      remaining-=file.size;
      for(const listener of observers)listener({remaining,total:manifest.total});
    }
  })().finally(()=>{downloading=null;observers.clear();});
  return downloading;
}

async function status() {
  const cache=await caches.open(cacheName);
  let remaining=0;
  for(const file of manifest.files)if(!await intact(await cache.match(key(file)),file))remaining+=file.size;
  return {remaining,total:manifest.total,version:manifest.version};
}

self.addEventListener('install',event=>event.waitUntil(download()));
self.addEventListener('activate',event=>{
  event.waitUntil((async()=>{
    // The previous worker remains active until its tabs close. Only a verified release replaces it.
    await Promise.all((await caches.keys()).filter(name=>name.startsWith(prefix)&&name!==cacheName)
      .map(name=>caches.delete(name)));
    await self.clients.claim();
  })());
});
self.addEventListener('message',event=>{
  const port=event.ports[0],type=event.data?.type;
  if(!port||!['offline-status','offline-download'].includes(type))return;
  event.waitUntil((async()=>{
    try {
      if(type==='offline-download')await download(progress=>port.postMessage({progress}));
      port.postMessage({status:await status()});
    }catch(error){port.postMessage({error:error.name==='QuotaExceededError'?'Free up browser storage and try again.':error.message});}
  })());
});
self.addEventListener('fetch',event=>{
  const request=event.request,url=new URL(request.url);
  if(request.method!=='GET'||url.origin!==scope.origin)return;
  const navigation=request.mode==='navigate'&&(url.pathname===scope.pathname||url.pathname===keyPath(home));
  const file=navigation?home:entries.get(url.pathname);
  if(!file)return;
  event.respondWith(serve(file,navigation));
});
function keyPath(file){return new URL(file.path,scope).pathname;}
async function serve(file,navigation) {
  try {
    const cache=await caches.open(cacheName),cached=await cache.match(key(file));
    if(cached&&await intact(cached.clone(),file))return cached;
    const response=await fetchAsset(file);
    if(await intact(response.clone(),file)) {
      try {await cache.put(key(file),response.clone());}catch{}
      return response;
    }
    // If the running worker missed a deployment and its shell is gone, let the browser load the newer shell.
    if(navigation&&response.ok)return response;
  }catch{}
  if(navigation)return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Blackmere House</title><h1>Offline files need repair</h1><p>Reconnect and reopen Blackmere House to restore the game files.</p>',
    {status:503,headers:{'Content-Type':'text/html; charset=utf-8'}});
  return new Response('Offline file unavailable',{status:503});
}
