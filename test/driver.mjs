import {createSimulation,key,action} from '../dist/src/simulation.js';
import {floorY} from '../dist/src/rules.js';

const turn=a=>Math.atan2(Math.sin(a),Math.cos(a));
export function play(seed,difficulty,route) {
  const sim=createSimulation(seed,difficulty);
  const {player:p}=sim.state;
  const log=[];
  function press(keys=0,yaw=p.yaw,pitch=p.pitch,act=0,slot=-1) {
    const cmd=[keys,Math.round(turn(yaw-p.yaw)*1000),Math.round((pitch-p.pitch)*1000),act,slot];
    log.push(cmd);sim.tick(cmd);
  }
  function wake() {if(sim.state.mode==='interlude')press(0,p.yaw,p.pitch,action.wake);}
  function go(x,z) {
    let route=sim.nav.path(p.x,p.z,x,z);
    let attempts=0,last=[p.x,p.z];
    for(let i=0;i<3800&&sim.state.mode==='play';i++) {
      if(Math.hypot(x-p.x,z-p.z)<.11)return true;
      while(route.length&&Math.hypot(route[0][0]-p.x,route[0][1]-p.z)<.14)route.shift();
      const [a,b]=route[0]??[x,z];
      if(i%25===0) {
        if(Math.hypot(last[0]-p.x,last[1]-p.z)<.03)attempts++;
        else attempts=0;
        last=[p.x,p.z];
        if(attempts>4)return false;
        route=sim.nav.path(p.x,p.z,x,z);
      }
      const yaw=Math.atan2(p.x-a,p.z-b);
      const door=sim.world.doors.find(d=>!d.open&&d.kind==='door'&&!d.secret&&
        Math.hypot(d.x-p.x,d.z-p.z)<1.45&&Math.abs(turn(Math.atan2(p.x-d.x,p.z-d.z)-yaw))<.47);
      if(door) {
        const angle=Math.atan2(p.x-door.x,p.z-door.z);
        press(0,angle,0);
        if(sim.target()===door){press(0,angle,0,action.use);continue;}
      }
      press(key.forward|(sim.state.stamina>.43?key.sprint:0),yaw,0);
    }
    return false;
  }
  function perform(o) {
    if(sim.state.mode!=='play')return false;
    const candidates=[];
    for(const radius of [1.17,1.42,1.60,1.81])for(let i=0;i<24;i++) {
      const a=i*Math.PI/12,x=o.x+Math.cos(a)*radius,z=o.z+Math.sin(a)*radius;
      if(sim.nav.blocked(x,z,.25))continue;
      const path=sim.nav.path(p.x,p.z,x,z);
      if(!path.length)continue;
      const snapshot=JSON.parse(JSON.stringify(sim.snapshot())),probe=createSimulation(seed,difficulty,snapshot);
      const eye=1.66+floorY(x,z),pitch=Math.atan2(o.y-eye,radius),yaw=Math.atan2(x-o.x,z-o.z);
      Object.assign(probe.state.player,{x,z,eye,pitch,yaw});
      if(probe.target()?.index===o.index)candidates.push({x,z,cost:path.length});
    }
    candidates.sort((a,b)=>a.cost-b.cost);
    for(const c of candidates.slice(0,8)) {
      if(!go(c.x,c.z))continue;
      const yaw=Math.atan2(p.x-o.x,p.z-o.z),pitch=Math.atan2(o.y-p.eye,Math.hypot(p.x-o.x,p.z-o.z));
      press(0,yaw,pitch);
      if(sim.target()===o){press(0,yaw,pitch,action.use);return true;}
    }
    return false;
  }
  const find=name=>sim.world.objects.find(o=>o.name===name);
  const inventory=id=>sim.state.inventory.some(i=>sim.world.objects[i].id===id);
  function collect(id) {
    if(inventory(id))return true;
    const o=sim.world.items.find(i=>i.id===id);
    if(o.container!==null&&!sim.world.objects[o.container].open&&!perform(sim.world.objects[o.container]))return false;
    return perform(o)&&inventory(id);
  }
  const pgr=sim.state.progress;
  let rounds=0;
  while(rounds++<18&&!['victory','defeat'].includes(sim.state.mode)) {
    wake();
    if(route==='front'){
      if(!pgr.unlock&&!collect('key'))continue;
      if(!pgr.cut&&!collect('cutters'))continue;
      const door=find('Front Door');
      if(!pgr.cut&&!perform(door))continue;
      if(!pgr.unlock&&!perform(door))continue;
      perform(door);
    }else{
      if(!pgr.power&&!collect('fuse'))continue;
      if(!pgr.handle&&!collect('crank'))continue;
      if(!pgr.power&&!perform(find('Cellar Fuse Box')))continue;
      const gate=find('Drain Gate');
      if(!pgr.handle&&!perform(gate))continue;
      perform(gate);
    }
  }
  if(sim.state.mode!=='victory')throw new Error('Could not drive '+route+' escape with seed '+seed+' '+JSON.stringify({state:sim.state.mode,day:sim.state.day,tick:sim.state.tick,player:p,progress:pgr,inventory:sim.state.inventory}));
  return {log,sim};
}
export function pack(log,group=145) {
  const batches=[];
  for(let i=0;i<log.length;i+=group) {
    const batch=[];
    for(const input of log.slice(i,i+group)) {
      const last=batch.at(-1);
      if(last&&input[3]===0&&input[4]===-1&&input.every((v,j)=>v===last[j+1]))last[0]++;
      else batch.push([1,...input]);
    }
    batches.push(batch);
  }
  return batches;
}
