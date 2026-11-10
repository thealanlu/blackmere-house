import level from './level-data.js';
import legacy from './level-legacy.js';
import {bounds,levels} from './rules.js';
import {HIDE_EXIT_TICKS} from './hide-view.js';

export const CHECKPOINT_VERSION=2;

const obj=o=>o&&typeof o==='object'&&!Array.isArray(o);
const int=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
const finite=(v,min,max)=>Number.isFinite(v)&&v>=min&&v<=max;
const place=p=>obj(p)&&finite(p.x,bounds.x0,bounds.x1)&&finite(p.z,bounds.z0,bounds.z1);
const flags=(o,keys)=>obj(o)&&keys.every(k=>typeof o[k]==='boolean');
const point=p=>Array.isArray(p)&&p.length===2&&finite(p[0],-18,18)&&finite(p[1],-18,18);
const points=(a,max)=>Array.isArray(a)&&a.length<=max&&a.every(point);
const item=i=>int(i,0,level.objects.length-1)&&level.objects[i].kind==='item';
const hide=i=>i===null||int(i,0,level.objects.length-1)&&level.objects[i].kind==='hide';
const look=p=>place(p)&&finite(p.yaw,-12.6,12.6)&&finite(p.pitch,-1.45,1.45);

export function validCheckpoint(value) {
  if(!obj(value)||value.version!==CHECKPOINT_VERSION||!Object.hasOwn(levels,value.difficulty)||!obj(value.state))return false;
  const s=value.state,p=s.player,b=s.brain;
  if(!['play','interlude'].includes(s.mode)||!int(s.day,1,5)||!int(s.tick,0,900_000)||!int(s.rng,0,4294967295)||
    !look(p)||!flags(p,['crouch'])||!hide(p.hidden)||!finite(p.eye,-1.2,2.4)||
    !(p.hideExit===undefined&&p.hideLeave===undefined||
      p.hidden!==null&&int(p.hideExit,1,HIDE_EXIT_TICKS)&&place(p.hideLeave))||
    !(s.hiddenFrom===null||look(s.hiddenFrom))||!flags(s,['tired','flash'])||
    !flags(s.progress,['cut','unlock','power','handle'])||!finite(s.stamina,0,1)||!finite(s.step,-.1,1)||
    !Array.isArray(s.inventory)||s.inventory.length>4||!s.inventory.every(item)||!int(s.selected,0,3)||
    !obj(b)||!place(b.actor)||b.difficulty!==value.difficulty||!['patrol','alert','investigate','search','chase','attack'].includes(b.state)||
    !finite(b.heading,-100000,100000)||!finite(b.pace,0,2)||!finite(b.stride,0,900000)||
    !Number.isFinite(b.timer)||!Number.isFinite(b.repath)||!Number.isFinite(b.spawnTime)||!Number.isFinite(b.doorWait)||
    !Number.isFinite(b.seen)||!Number.isFinite(b.gaze)||!int(b.stage,0,12)||!hide(b.check)||
    !points(b.patrol,13)||b.patrol.length!==13||!points(b.waypoints,800)||!points(b.searchPoints,4)||
    !(b.goal===null||point(b.goal))||!(b.remembered===null||point(b.remembered))||
    !(b.lastNoise===null||obj(b.lastNoise)&&point(b.lastNoise.point)&&Number.isFinite(b.lastNoise.strength)))return false;
  if(!Array.isArray(s.objects)||s.objects.length>level.objects.length||!Array.isArray(s.flying)||s.flying.length>4||
    !s.flying.every(f=>obj(f)&&item(f.index)&&[f.vx,f.vy,f.vz].every(n=>finite(n,-80,80))&&typeof f.impact==='boolean'))return false;
  const seen=new Set();
  for(const entry of s.objects) {
    if(!Array.isArray(entry)||entry.length!==2)return false;
    const [i,p]=entry;
    if(!int(i,0,level.objects.length-1)||seen.has(i)||!obj(p))return false;
    seen.add(i);
    const o=level.objects[i];
    if(o.kind==='item'){
      if(!place(p)||!finite(p.y,-1.6,6)||!flags(p,['available','flying'])||
        !(p.container===null||int(p.container,0,level.objects.length-1))||
        Object.keys(p).some(k=>!['x','z','y','available','container','flying'].includes(k)))return false;
    }else if(!(o.blocker!==undefined||o.kind==='drawer'||o.panels)||!flags(p,['open'])||
      !(p.swing===undefined||finite(p.swing,-2,2))||Object.keys(p).some(k=>!['open','swing'].includes(k)))return false;
  }
  return legacy.objects.every((o,i)=>!(o.kind==='item'||o.blocker!==undefined||o.kind==='drawer'||o.panels)||seen.has(i));
}
