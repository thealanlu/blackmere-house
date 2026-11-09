import {RUN_VERSION} from './rules.js';

let refresh;
export async function api(path,{method='GET',data,signal,retry=true}={}) {
  const response=await fetch('/api/'+path,{method,signal,credentials:'same-origin',cache:'no-store',
    headers:data?{'Content-Type':'application/json'}:undefined,body:data?JSON.stringify(data):undefined});
  if(response.status===401&&retry&&!path.startsWith('auth/')) {
    refresh??=api('auth/refresh',{method:'POST',retry:false}).catch(()=>null).finally(()=>{refresh=null;});
    const r=await refresh;
    if(r?.signedIn)return api(path,{method,data,signal,retry:false});
  }
  const result=await response.json().catch(()=>null);
  if(!response.ok||!result) {
    const error=new Error(result?.error??'Online services are unavailable. Guest play is available.');
    error.status=response.status;throw error;
  }
  return result;
}

const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
export async function rankedAttempt(difficulty,onStatus) {
  const attempt=await api('runs',{method:'POST',data:{difficulty,version:RUN_VERSION}});
  const endpoint='runs/'+attempt.id+'/';
  let rows=[],size=0,seq=0,closed=false,failure=null,sending=Promise.resolve(),result=null;
  function flush() {
    if(!size||closed||failure)return;
    const batch=rows;
    rows=[];size=0;
    sending=sending.then(async()=>{
      if(closed||failure)return;
      for(let tries=0;tries<4;tries++) {
        try{
          const r=await api(endpoint+'step',{method:'POST',data:{seq,batch}});
          seq=r.seq;result=r.result;return;
        }catch(error){
          if((error.status&&error.status<500)||tries===3) {
            failure=error;onStatus(error.message);return;
          }
          await wait(400*2**tries);
        }
      }
    });
  }
  const timer=setInterval(flush,5200);
  return {...attempt,
    record(input) {
      if(closed||failure)return;
      const last=rows.at(-1);
      if(last&&input[3]===0&&input[4]===-1&&input.every((v,i)=>v===last[i+1]))last[0]++;
      else rows.push([1,...input]);
      if(++size===240)flush();
    },
    async finish() {
      clearInterval(timer);flush();await sending;closed=true;
      if(failure)throw failure;
      if(!result)throw new Error('The server did not verify a completed result.');
      return result;
    },
    cancel(){
      closed=true;clearInterval(timer);
      api(endpoint+'cancel',{method:'POST'}).catch(()=>{});
    }
  };
}
