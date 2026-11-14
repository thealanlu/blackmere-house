let opening;
const fallbackKey=key=>key==='settings'?'blackmere.settings':key.startsWith('save:')?
  'blackmere.checkpoint.'+key.slice(5):'blackmere.local.'+key;

function database() {
  opening??=new Promise((resolve,reject)=>{
    const request=indexedDB.open('blackmere-progress',1);
    request.onupgradeneeded=()=>request.result.createObjectStore('progress');
    request.onsuccess=()=>{
      request.result.onversionchange=()=>{request.result.close();opening=null;};
      resolve(request.result);
    };
    request.onerror=()=>reject(request.error);
    request.onblocked=()=>reject(new Error('Local storage is busy.'));
  });
  return opening;
}
async function transact(mode,operation) {
  const db=await database();
  return new Promise((resolve,reject)=>{
    const tx=db.transaction('progress',mode),request=operation(tx.objectStore('progress'));
    tx.oncomplete=()=>resolve(request.result);
    tx.onabort=()=>reject(tx.error??request.error);
  });
}
function fallback(key) {
  try{return JSON.parse(localStorage.getItem(fallbackKey(key))??'null');}catch{return null;}
}
export async function readLocal(key) {
  try {
    const value=await transact('readonly',store=>store.get(key));
    const previous=fallback(key);
    return value===undefined||previous&&previous.updated>(value?.updated??0)?previous:value;
  }catch{return fallback(key);}
}
const same=(a,b)=>JSON.stringify(a??null)===JSON.stringify(b??null);
export async function writeLocal(key,value,expected) {
  if(arguments.length===3) {
    try {
      const db=await database();
      return await new Promise((resolve,reject)=>{
        const tx=db.transaction('progress','readwrite'),store=tx.objectStore('progress');
        const request=store.get(key);
        let written=false;
        request.onsuccess=()=>{
          const old=fallback(key),valueInDb=request.result;
          const current=valueInDb===undefined||old&&old.updated>(valueInDb?.updated??0)?old:valueInDb;
          if(!same(current,expected))return;
          store.put(value,key);written=true;
        };
        tx.oncomplete=()=>{
          if(written)try{localStorage.removeItem(fallbackKey(key));}catch{}
          resolve(written);
        };
        tx.onabort=()=>reject(tx.error??request.error);
      });
    }catch {
      if(!same(fallback(key),expected))return false;
      try{localStorage.setItem(fallbackKey(key),JSON.stringify(value));return true;}catch{return false;}
    }
  }
  try {
    await transact('readwrite',store=>store.put(value,key));
    // Remove a migrated legacy copy only after the IndexedDB transaction commits.
    try{localStorage.removeItem(fallbackKey(key));}catch{}
    return true;
  }catch {
    try{localStorage.setItem(fallbackKey(key),JSON.stringify(value));return true;}catch{return false;}
  }
}
