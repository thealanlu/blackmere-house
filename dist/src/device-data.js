import {api} from './online.js';
import {preferencePatch,sharedPreferences} from './preferences.js';
import {validCheckpoint} from './checkpoint.js';

import {readLocal,writeLocal} from './local-progress.js';

const key=id=>'save:'+(id??'guest');
const same=(a,b)=>JSON.stringify(a)===JSON.stringify(b);
function saveEntry(value) {
  if(Number.isFinite(value?.updated)&&(value.checkpoint===null||validCheckpoint(value.checkpoint))) {
    return {...value,dirty:value.dirty??true};
  }
  return null;
}
const load=async id=>saveEntry(await readLocal(key(id)));
export function deviceData(apply,onStatus) {
  let owner=null,queue={},edited=new Set(),timer,active,version=0;
  function account(id) {
    if(owner===id)return;
    owner=id;queue={};edited=new Set();version++;
    clearTimeout(timer);
    if(id)preferences(id,version);
  }
  async function preferences(id,generation) {
    try {
      const result=await api('preferences');
      if(owner!==id||version!==generation)return;
      const patch=preferencePatch(result.preferences)??{};
      for(const k of edited)delete patch[k];
      apply(patch);
      onStatus('Audio, aim, brightness, and accessibility preferences follow your account.');
    }catch{}
  }
  async function send() {
    if(!owner||!navigator.onLine||!Object.keys(queue).length||active)return;
    const patch=queue,id=owner;
    queue={};active=id;
    let complete=false;
    try{await api('preferences',{method:'POST',data:patch});complete=true;}
    catch{if(owner===id)queue={...patch,...queue};}
    finally{
      active=null;
      if(complete&&owner===id&&Object.keys(queue).length){clearTimeout(timer);timer=setTimeout(send,220);}
    }
  }
  addEventListener('online',()=>{send();});
  return {
    account,
    flush:send,
    change(name,value) {
      if(!owner||!sharedPreferences.includes(name))return;
      edited.add(name);queue[name]=value;
      clearTimeout(timer);timer=setTimeout(send,750);
    },
    read:load,
    async compare(id,source=id) {
      if(!id||owner!==id||!navigator.onLine)return null;
      const cloud=await api('checkpoint');
      if(owner!==id)return null;
      const previous=await readLocal(key(source));
      const local=saveEntry(previous);
      const differing=!same(local?.checkpoint??null,cloud.checkpoint);
      if(source===id&&!local?.dirty&&differing) {
        await writeLocal(key(id),{checkpoint:cloud.checkpoint,updated:cloud.updated,dirty:false},previous);
      }
      return {cloud,local,source,previous,conflict:Boolean(local?.dirty&&differing&&cloud.checkpoint),
        pending:Boolean(local?.dirty&&local.checkpoint&&differing)};
    },
    async local(id,checkpoint,replay) {
      return writeLocal(key(id),{checkpoint,replay,updated:Date.now(),dirty:true});
    },
    async sync(id,comparison,choice) {
      if(!id||owner!==id||!navigator.onLine||!comparison)throw new Error('Sign in and reconnect to sync this save.');
      const {cloud,local,source,previous}=comparison;
      const current=await load(source);
      if(!same(current,local))throw new Error('The local save changed. Review the updated copies first.');
      if(choice==='cloud') {
        if(!cloud.checkpoint)throw new Error('There is no cloud save to restore.');
        const latest=await api('checkpoint');
        if(latest.revision!==cloud.revision||owner!==id||!same(await load(id),local))
          throw new Error('A save changed. Review the updated copies first.');
        if(local?.checkpoint&&!await writeLocal('backup:'+id,local)||!await writeLocal(key(id),{checkpoint:cloud.checkpoint,updated:cloud.updated,dirty:false},previous))
          throw new Error('Could not save both copies on this device.');
        return;
      }
      if(!local?.checkpoint)throw new Error('There is no local checkpoint to upload.');
      if(cloud.checkpoint&&!await writeLocal('backup:'+id,{...cloud,dirty:true}))
        throw new Error('Could not make a backup of the cloud save.');
      await api('checkpoint',{method:'POST',data:{owner:id,revision:cloud.revision,checkpoint:local.checkpoint}});
      if(owner===id&&same(await load(source),local))await writeLocal(key(source),{...local,dirty:false},previous);
    },
    async backup(id){return (await readLocal('backup:'+id))?.checkpoint??null;}
  };
}
