import {api} from './online.js';
import {preferencePatch,sharedPreferences} from './preferences.js';
import {validCheckpoint} from './checkpoint.js';

const key=id=>'blackmere.checkpoint.'+(id??'guest');
function load(id) {
  try{
    const value=JSON.parse(localStorage.getItem(key(id))??'null');
    if(Number.isFinite(value?.updated)&&(value.checkpoint===null||validCheckpoint(value.checkpoint)))return value;
  }catch{}
  return null;
}
function store(id,value) {
  try{localStorage.setItem(key(id),JSON.stringify(value));return true;}catch{return false;}
}
export function deviceData(apply,onStatus) {
  let owner=null,queue={},edited=new Set(),timer,cloud=null,active,version=0;
  function account(id) {
    if(owner===id)return;
    owner=id;queue={};edited=new Set();cloud=null;version++;
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
    read(id){return load(id);},
    async refresh(id) {
      if(!id||!navigator.onLine)return load(id);
      try {
        const next=await api('checkpoint');
        if(owner!==id)return load(id);
        cloud=next;
        const local=load(id);
        if(next.updated>(local?.updated??0)&&(next.checkpoint===null||validCheckpoint(next.checkpoint))) {
          store(id,{checkpoint:next.checkpoint,updated:next.updated});return {checkpoint:next.checkpoint,updated:next.updated};
        }
      }catch{}
      return load(id);
    },
    local(id,checkpoint){return store(id,{checkpoint,updated:Date.now()});},
    async save(id,checkpoint) {
      const saved=store(id,{checkpoint,updated:Date.now()});
      if(!id||owner!==id||!navigator.onLine||!cloud) {
        if(!saved)throw new Error('This device could not store the save.');
        return false;
      }
      try {
        const next=await api('checkpoint',{method:'POST',data:{revision:cloud.revision,checkpoint}});
        if(owner===id)cloud={...next,checkpoint};
        store(id,{checkpoint,updated:next.updated});
        return true;
      }catch(error) {
        if(!saved)throw error;
        throw new Error(error.status===409?'Saved on this device. A newer cloud save is available.':'Saved on this device. Cloud sync is unavailable.');
      }
    }
  };
}
