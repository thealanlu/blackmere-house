import {createSimulation,moveSurvivor,key,action} from './simulation.js';
import {clamp,floorY,levels,PRE_SLOWDOWN_RUN_VERSION,RUN_VERSION,SPAWN,TICK,DOOR_ALERT_MS,hasMap} from './rules.js';
import {peekSees} from './hide-view.js';

export const MATCH_VERSION=3;
export const skill={trap:32,bolt:64};
export const durations=[6,8,10];
export const preferences=['survivor','granny','random'];
export const graceMs=45_000;
const tickMs=TICK*1000;
const currentGrannySpeed=2.82;
const grannySpeed=room=>room.physicsVersion===undefined||room.physicsVersion===PRE_SLOWDOWN_RUN_VERSION?3.38:room.difficulty==='nightmare'?3.20:currentGrannySpeed;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const gap=(a,b)=>Math.hypot(a.x-b.x,a.z-b.z);
const round=(n)=>Math.round(n*1000)/1000;
const active=p=>p.role==='survivor'&&p.status==='active';
const players=room=>room.members.filter(p=>p.role==='survivor');

export function newMember(profile,now) {
  return {id:profile.id,name:profile.username,ticket:crypto.randomUUID(),preference:'random',ready:false,seen:now};
}
export function livingRoom(room,now) {
  return room.members.filter(p=>now-p.seen<graceMs&&!p.left);
}
export function notice(room,kind,data={}) {
  room.events.push({n:++room.eventSeq,kind,...data});
  if(room.events.length>30)room.events.shift();
}
export function startMatch(room,now,seed=crypto.getRandomValues(new Uint32Array(1))[0]) {
  const members=livingRoom(room,now);
  const volunteers=members.filter(p=>p.preference==='granny'),random=members.filter(p=>p.preference==='random');
  const pool=volunteers.length?volunteers:random.length?random:members;
  const hunter=room.mode==='pvp'?pool[seed%pool.length]:null;
  room.members=members;
  room.physicsVersion=RUN_VERSION;
  room.phase='play';room.game=crypto.randomUUID();room.winner=null;room.reason=null;room.started=now;
  room.forfeit=false;room.ranked=false;room.recorded=false;room.chat=[];
  room.clock=now;room.deadline=now+room.minutes*60_000;
  room.events=[];room.eventSeq=0;room.traps=[];room.bolts={};room.doorAlerts={};room.scareAt=now+28_000;
  const sim=createSimulation(seed,room.difficulty);
  let i=0;
  for(const p of members) {
    p.role=p===hunter?'granny':'survivor';p.status='active';p.seq=0;p.keys=0;p.actions=0;p.slot=-1;
    p.stamina=1;p.tired=false;p.step=0;p.flash=p!==hunter;p.charge=p===hunter?0:1;p.hiddenFrom=null;p.inventory=[];p.selected=0;
    p.escapedAt=0;p.downAt=0;p.finishedAt=0;p.safeUntil=0;p.slowUntil=0;p.attackAt=0;p.trapAt=0;p.boltAt=0;
    p.objectives=0;p.rescues=0;p.captures=0;p.captureTime=0;p.stride=.5;p.pace=0;p.spectate=null;
    p.emergedAt=0;
    p.voice=null;
    if(p===hunter)p.body={x:-7.7,z:-9,yaw:-Math.PI/2,pitch:0,eye:1.86,crouch:false,hidden:null};
    else {
      const [dx,dz]=[[0,0],[-.85,-.72],[.06,-1.4],[.88,.69]][i++];
      p.body={...sim.state.player,x:SPAWN.x+dx,z:SPAWN.z+dz};
    }
    p.yaw=p.body.yaw;p.pitch=p.body.pitch;
  }
  room.world=sim.snapshot();
  room.worldVersion=1;
}

export function acceptInput(p,d) {
  if(d.seq<=p.seq)return;
  p.seq=d.seq;p.keys=d.keys;p.yaw=d.yaw/1000;p.pitch=d.pitch/1000;
  p.actions|=d.actions;
  if(d.slot!==-1)p.slot=d.slot;
}
function inReach(sim,a,b,radius) {
  return gap(a,b)<radius&&sim.nav.clear(a.x,a.z,b.x,b.z,.07);
}
function facing(a,b,tolerance) {
  return Math.abs(wrap(Math.atan2(a.x-b.x,a.z-b.z)-a.yaw))<tolerance;
}
function hideBody(seat,sim) {
  if(seat.body.hidden===null)return;
  if(seat.hiddenFrom)Object.assign(seat.body,seat.hiddenFrom);
  const spot=sim.world.objects[seat.body.hidden];
  if(spot?.panels)sim.world.setContainer(spot,true);
  delete seat.body.hideExit;delete seat.body.hideLeave;
  seat.body.hidden=null;seat.hiddenFrom=null;
}
function dropPack(seat,sim) {
  for(const [i,index] of seat.inventory.entries()) {
    const it=sim.world.objects[index],dx=.17*Math.cos(i*2),dz=.17*Math.sin(i*2);
    const {x,z}=seat.body,clear=!sim.nav.blocked(x+dx,z+dz,.07);
    Object.assign(it,{x:clear?x+dx:x,z:clear?z+dz:z,y:floorY(x,z)+.16+i*.095,
      available:true,container:null,flying:false});
  }
  seat.inventory=[];seat.selected=0;
}
function capture(room,sim,victim,hunter,at) {
  if(!victim||!active(victim)||victim.safeUntil>room.clock||victim.body.hidden!==null)return;
  hideBody(victim,sim);dropPack(victim,sim);
  victim.status='captured';victim.downAt=room.clock;victim.pace=0;victim.keys=0;
  victim.body.eye=floorY(victim.body.x,victim.body.z)+.55;
  if(hunter){hunter.captures++;hunter.captureTime+=room.clock-room.started;}
  notice(room,'capture',{target:victim.id,text:victim.name+' was captured.'});
  notice(room,'attack',{x:at.x,z:at.z,radius:12});
}
function release(room,p,reason) {
  p.status='eliminated';p.finishedAt=room.clock;p.pace=0;
  notice(room,'roster',{text:p.name+reason});
}
function finish(room,winner,reason) {
  room.phase='result';room.winner=winner;room.reason=reason;
  room.finished=room.clock;
}
function checkEnd(room) {
  const team=players(room),escaped=team.some(p=>p.status==='escaped');
  if(room.mode==='pvp'&&room.members.find(p=>p.role==='granny')?.status==='eliminated') {
    finish(room,'survivors','The Caretaker left the match.');
  } else if(!team.some(active)||room.clock>=room.deadline) {
    finish(room,escaped?'survivors':'granny',escaped?'At least one Survivor escaped.':
      room.clock>=room.deadline?'The escape window closed.':'The Caretaker stopped every Survivor.');
  }
}
function nearest(seats,body,radius,allowed) {
  let target=null,best=radius;
  for(const p of seats) {
    const distance=gap(p.body,body);
    if(distance<best&&allowed(p)){target=p;best=distance;}
  }
  return target;
}
function sound(room,kind,at,radius,source) {
  if(at)notice(room,kind,{x:round(at.x),z:round(at.z),radius,source,running:at.running,foot:at.foot});
}

export function moveGranny(body,nav,keys,pace=currentGrannySpeed) {
  const x=Number(Boolean(keys&key.right))-Number(Boolean(keys&key.left));
  const z=Number(Boolean(keys&key.forward))-Number(Boolean(keys&key.back));
  const length=Math.hypot(x,z);
  if(!length)return 0;
  const {x:oldX,z:oldZ,yaw}=body,speed=pace*TICK/length;
  nav.move(body,(x*Math.cos(yaw)-z*Math.sin(yaw))*speed,(-x*Math.sin(yaw)-z*Math.cos(yaw))*speed,.24);
  return Math.hypot(body.x-oldX,body.z-oldZ);
}

function hunt(room,sim,p,command) {
  const b=p.body,at=room.clock,doors=sim.world.doors;
  p.body.yaw=p.yaw;p.body.pitch=p.pitch;
  const warm=at-room.started>=6500;
  const travel=warm&&at>=p.attackAt-860?moveGranny(b,sim.nav,command.keys,grannySpeed(room)):0;
  b.eye=floorY(b.x,b.z)+1.86;p.pace=travel/(TICK*3.4);
  const stride=p.stride;
  p.stride+=travel/.94;
  if(Math.floor(stride)!==Math.floor(p.stride))sound(room,'enemyStep',{...b,running:true,foot:Math.floor(p.stride)%2},11,p.id);
  if(!warm)return;
  const door=doors.find(d=>d.kind==='door'&&!d.secret&&gap(d,b)<1.64&&facing(b,d,.69));
  if(command.actions&action.use) {
    const target=nearest(players(room),b,1.47,v=>active(v)&&v.safeUntil<=at&&v.body.hidden===null&&
      facing(b,v.body,.72)&&inReach(sim,b,v.body,1.47));
    if(door&&!door.open&&!target)sim.toggleDoor(door,true,true,b);
    else if(at>=p.attackAt) {
      p.attackAt=at+1650;
      if(target)capture(room,sim,target,p,b);
      else sound(room,'swing',b,7,p.id);
    }
  }
  if(command.actions&skill.trap&&at>=p.trapAt) {
    const point={x:b.x-Math.sin(b.yaw)*.70,z:b.z-Math.cos(b.yaw)*.70};
    if(!sim.nav.blocked(point.x,point.z,.24)&&room.traps.length<2&&!room.traps.some(t=>gap(t,point)<1.5)) {
      room.traps.push({...point,expires:at+72_000});p.trapAt=at+20_000;
      notice(room,'toast',{target:p.id,text:'Snare set.'});
    }
  }
  if(command.actions&skill.bolt&&door&&at>=p.boltAt&&!room.bolts[door.index]) {
    const occupancy=players(room).some(v=>active(v)&&gap(v.body,door)<.76);
    if(!occupancy&&gap(b,door)>.61) {
      sim.toggleDoor(door,false,true);
      if(!door.open){room.bolts[door.index]=at+12_000;p.boltAt=at+25_000;sound(room,'door',door,8,p.id);}
    }
  }
}

function rescue(room,sim,p) {
  const target=nearest(players(room),p.body,1.56,v=>v.status==='captured'&&facing(p.body,v.body,.98)&&inReach(sim,p.body,v.body,1.56));
  if(!target||p.body.hidden!==null)return false;
  target.status='active';target.safeUntil=room.clock+4200;target.downAt=0;p.rescues++;
  notice(room,'roster',{text:p.name+' rescued '+target.name+'.'});
  sound(room,'door',target.body,6,p.id);
  return true;
}

export function advanceMatch(room,now) {
  if(room.phase!=='play')return;
  const previousWorld=JSON.stringify([room.world.objects,room.world.progress]);
  const activeRoom=room.members.some(p=>now-p.seen<1250&&!p.left);
  if(!activeRoom&&now-room.clock>1200)room.clock=now;
  else room.clock=Math.max(room.clock,now-650);
  let acting,aiTarget;
  const party={
    occupied:o=>room.members.some(p=>p.status==='active'&&p.body.hidden===null&&gap(o,p.body)<.60),
    locked:index=>room.bolts[index]>room.clock,
    hiding:index=>players(room).some(p=>active(p)&&p.body.hidden===index),
    target:p=>{aiTarget=p.id;},
    caught:at=>capture(room,sim,room.members.find(p=>p.id===aiTarget),null,at),
    escape:()=>{
      acting.status='escaped';acting.escapedAt=room.clock;acting.finishedAt=room.clock;acting.pace=0;
      dropPack(acting,sim);
      notice(room,'roster',{text:acting.name+' escaped the house.'});
    }
  };
  const sim=createSimulation(0,room.difficulty,room.world,(kind,data)=>{
    if(kind==='sound') {
      const range={step:acting?.body.crouch?2:acting?.keys&key.sprint?11:6,door:8,drop:13,power:12,enemyStep:11,item:4};
      sound(room,data.kind,data.at,range[data.kind]??5,data.kind==='enemyStep'?null:acting?.id);
    } else if(kind==='grannyDoor'&&hasMap(room.difficulty))room.doorAlerts[data.door]=room.clock;
    else if(kind==='toast'&&acting)notice(room,'toast',{target:acting.id,text:data});
    else if(kind==='note'&&acting)notice(room,'toast',{target:acting.id,text:data.name});
  },party,room.physicsVersion??RUN_VERSION);

  function expire() {
    for(const p of room.members) {
      if(p.status==='eliminated'||p.status==='escaped')continue;
      if(p.left||room.clock-p.seen>=graceMs) {
        room.forfeit=true;hideBody(p,sim);dropPack(p,sim);release(room,p,' disconnected.');
      } else if(p.status==='captured'&&room.clock-p.downAt>=29_000)release(room,p,' was eliminated.');
    }
    room.traps=room.traps.filter(t=>t.expires>room.clock);
    for(const [index,until] of Object.entries(room.bolts))if(until<=room.clock)delete room.bolts[index];
  }
  while(room.phase==='play'&&room.clock+tickMs<=now+.0001) {
    room.clock+=tickMs;
    expire();
    checkEnd(room);
    if(room.phase!=='play')break;
    for(const p of room.members) {
      if(p.status!=='active')continue;
      acting=p;
      const fresh=room.clock-p.seen<560;
      const keys=fresh?p.keys:0,actions=fresh?p.actions:0,slot=fresh?p.slot:-1;
      p.actions=0;p.slot=-1;
      if(p.role==='granny'){hunt(room,sim,p,{keys,actions});continue;}
      const interacting=Boolean(actions&action.use)&&rescue(room,sim,p);
      const concealed=p.body.hidden!==null;
      const before=Object.values(sim.state.progress).filter(Boolean).length;
      const move=sim.controlSeat(p,[p.slowUntil>room.clock?0:keys,Math.round(wrap(p.yaw-p.body.yaw)*1000),
        Math.round((p.pitch-p.body.pitch)*1000),interacting?actions&~action.use:actions&(15|action.reload),slot]);
      p.objectives+=Object.values(sim.state.progress).filter(Boolean).length-before;
      if(concealed&&p.body.hidden===null)p.emergedAt=room.clock;
      if(p.status!=='active')continue;
      p.pace=(move?.travelled??0)/(TICK*3.4);p.stride+=(move?.travelled??0)/(move?.sprint?.95:.73);
      if(p.body.hidden!==null)continue;
      const trap=room.traps.findIndex(t=>gap(t,p.body)<.47);
      if(trap>=0) {
        const [point]=room.traps.splice(trap,1);
        p.slowUntil=room.clock+2050;
        sound(room,'drop',point,14,p.id);
        notice(room,'toast',{target:p.id,text:'Caught in a snare. Hold on.'});
      }
    }
    acting=null;
    const candidates=room.mode==='coop'?players(room).filter(active).map(p=>({...p.body,id:p.id,flash:p.flash,hidden:
      p.body.hidden===null?null:sim.world.objects[p.body.hidden]})):null;
    sim.tickHouse(candidates);
    if(room.clock>=room.scareAt) {
      const seat=players(room).find(active);
      if(seat)sound(room,'settle',{x:seat.body.x+1.5,z:seat.body.z-2},12,null);
      room.scareAt+=41_000;
    }
  }
  if(room.phase==='play'&&now-room.clock<tickMs){expire();checkEnd(room);}
  room.world=sim.snapshot();
  for(const [id,opened] of Object.entries(room.doorAlerts))if(room.clock-opened>=DOOR_ALERT_MS)delete room.doorAlerts[id];
  if(previousWorld!==JSON.stringify([room.world.objects,room.world.progress]))room.worldVersion++;
}

function avatar(p) {
  const {x,z,yaw,pitch,crouch,eye}=p.body;
  return {id:p.id,name:p.name,role:p.role,status:p.status,x:round(x),z:round(z),yaw:round(yaw),pitch:round(pitch),
    crouch,eye:round(eye),flash:p.role==='survivor'&&p.flash&&p.status==='active',stride:round(p.stride),pace:round(p.pace),attack:p.attackAt>0&&p.attackAt-990>p.viewTime,
    emerging:p.emergedAt?round(clamp(1-(p.viewTime-p.emergedAt)/480,0,1)):0};
}
export function viewMatch(room,seat,after,worldVersion=0) {
  const team=players(room),eligible=team.filter(p=>p!==seat&&active(p));
  const spectator=seat.status==='escaped'||seat.status==='eliminated';
  const watch=spectator?(eligible.find(p=>p.id===seat.spectate)??eligible[0]):null;
  const eye=watch??seat,body=eye.body;
  const sim=createSimulation(0,room.difficulty,room.world);
  const spot=body.hidden===null?null:sim.world.objects[body.hidden];
  const [lookX,lookZ]=spot?.peek??[body.x,body.z];
  const sees=(x,z,radius)=>Math.hypot(x-body.x,z-body.z)<radius&&
    (!spot||peekSees(spot,x,z))&&sim.nav.clear(lookX,lookZ,x,z);
  const canSee=p=>p.body.hidden===null&&sees(p.body.x,p.body.z,13);
  const roster=room.members.map(p=>({id:p.id,name:p.name,role:p.role,status:p.status,online:!p.left&&room.clock-p.seen<4000}));
  const avatars=room.members.filter(p=>p!==eye&&['active','captured'].includes(p.status)&&canSee(p))
    .map(p=>avatar({...p,viewTime:room.clock}));
  const brain=room.world.brain,actor=brain.actor;
  const ai=room.mode==='coop'&&sees(actor.x,actor.z,15)?
    {actor:{...actor},heading:brain.heading,gaze:brain.gaze,stride:brain.stride,pace:brain.pace,state:brain.state}:null;
  const world=room.worldVersion===worldVersion?undefined:room.world.objects.map(([i,o])=>sim.world.objects[i].kind==='item'&&
    (!o.available||(o.container!==null&&!sim.world.objects[o.container]?.open))?[i,{available:false}]:[i,o]);
  const events=room.events.filter(e=>e.n>after&&(e.target?e.target===seat.id||e.kind==='capture':
    e.x===undefined||gap(e,body)<e.radius*(seat.role==='granny'?1.28:1)));
  const timers={attack:seat.attackAt,trap:seat.trapAt,bolt:seat.boltAt,down:seat.downAt&&seat.downAt+29_000,
    slow:seat.slowUntil,warm:room.started+6500};
  const mapTeam=hasMap(room.difficulty)&&seat.role==='survivor'?team.filter(p=>p!==eye&&['active','captured'].includes(p.status)&&
    p.body.hidden===null&&gap(p.body,body)<8.5).map(p=>({id:p.id,x:round(p.body.x),z:round(p.body.z),down:p.status==='captured'})):[];
  const doorAlerts=hasMap(room.difficulty)&&seat.role==='survivor'?Object.entries(room.doorAlerts)
    .filter(([,opened])=>room.clock-opened<DOOR_ALERT_MS).map(([id,opened])=>[Number(id),opened]):[];
  const peers=room.voice&&seat.voice&&seat.status==='active'?room.members
    .filter(p=>p!==seat&&p.voice&&p.status==='active'&&!p.left&&room.clock-p.seen<4500).map(p=>{
      const open=sim.nav.clear(seat.body.x,seat.body.z,p.body.x,p.body.z);
      const strength=spot||p.body.hidden!==null?0:clamp(1-gap(seat.body,p.body)/(open?12:7.5),0,1)*(open?1:.47);
      return {id:p.id,version:p.voice,gain:Math.round(strength*10)/10};
    }):[];
  return {game:room.game,version:MATCH_VERSION,clock:room.clock,deadline:room.deadline,lastEvent:room.eventSeq,events,grannySpeed:grannySpeed(room),
    phase:room.phase,winner:room.winner,reason:room.reason,mode:room.mode,difficulty:room.difficulty,roster,avatars,ai,world,worldVersion:room.worldVersion,...(hasMap(room.difficulty)?{mapTeam,doorAlerts}:{}),
    me:{...avatar({...seat,viewTime:room.clock}),body:{...seat.body},flash:seat.flash,charge:seat.charge,stamina:seat.stamina,tired:seat.tired,
      inventory:seat.inventory,selected:seat.selected,seq:seat.seq,status:seat.status},watch:watch?{name:watch.name,body:{...body},flash:watch.flash,charge:watch.charge,inventory:watch.inventory}:null,
    progress:room.world.progress,timers,traps:room.traps.filter(t=>seat.role==='granny'||(gap(t,body)<2.1&&sim.nav.clear(body.x,body.z,t.x,t.z))),
    bolts:Object.keys(room.bolts).map(Number),voice:Boolean(room.voice),peers,casual:room.access!=='public'||Boolean(room.forfeit)};
}
