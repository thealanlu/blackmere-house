import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,action,key} from '../dist/src/simulation.js';
import {startMatch,advanceMatch,newMember,acceptInput,viewMatch} from '../dist/src/match.js';
import {DOOR_ALERT_MS,floorAt,floorY,PRE_LAYOUT_RUN_VERSION} from '../dist/src/rules.js';
import {hideHeading,HIDE_EXIT_TICKS} from '../dist/src/hide-view.js';
import {CHECKPOINT_VERSION,validCheckpoint} from '../dist/src/checkpoint.js';
import {validateMansion} from '../scripts/validate-level.mjs';

const idle=[0,0,0,0,-1],use=[0,0,0,action.use,-1];
function aim(body,spot,x,z) {
  const eye=floorY(x,z)+1.66;
  Object.assign(body,{x,z,eye,yaw:Math.atan2(x-spot.x,z-spot.z),pitch:Math.atan2(spot.y-eye,Math.hypot(x-spot.x,z-spot.z))});
}
function roomFor(mode) {
  const now=100_000,members=Array.from({length:mode==='pvp'?3:2},(_,i)=>newMember({id:String(i),username:'Test'+i},now));
  const room={mode,minutes:6,difficulty:'normal',members,chat:[],access:'private'};
  startMatch(room,now,100);
  room.clock=room.started+7600;
  return room;
}
function stepRoom(room,seat,actionCode,elapsed=34) {
  if(seat)acceptInput(seat,{seq:seat.seq+1,keys:0,yaw:Math.round(seat.body.yaw*1000),
    pitch:Math.round(seat.body.pitch*1000),actions:actionCode,slot:-1});
  const now=room.clock+elapsed;
  for(const p of room.members)p.seen=now;
  advanceMatch(room,now);
}

test('the physical mansion has ten routes and stays connected when an interior door is bolted',()=>{
  assert.deepEqual(validateMansion(),{rooms:7,routes:10,hiding:7});
  assert.equal(floorAt(4,-9),'main');assert.equal(floorAt(10,-9),'cellar');
});

test('all seven hiding spots have usable entrances, bounded aim and an authoritative safe exit',()=>{
  const source=createSimulation(1,'normal');
  for(const spec of source.world.hiding) {
    const events=[],sim=createSimulation(1,'normal',null,(kind,data)=>events.push({kind,data}));
    const h=sim.world.objects[spec.index],{player:p,brain}=sim.state;
    aim(p,h,...h.exit);
    assert.equal(sim.target()?.index,h.index,h.name+' is reachable at its entrance');
    sim.tick(use);
    assert.equal(p.hidden,h.index);
    assert.ok(!events.some(e=>e.kind==='sound'),h.name+' entry should be silent');
    const [x,z]=h.peek;
    Object.assign(brain.actor,{x,z});
    Object.assign(brain,{spawnTime:0,state:'search',check:h.index,goal:[x,z],timer:5,repath:0});
    sim.tick([key.forward,3200,2860,action.light,-1]);
    assert.equal(sim.state.mode,'play');
    assert.equal(p.hidden,h.index);
    assert.ok(Math.abs(Math.atan2(Math.sin(p.yaw-hideHeading(h)),Math.cos(p.yaw-hideHeading(h))))<=h.look+.001);
    assert.ok(p.pitch<=.25);
    assert.ok(!h.open);
    assert.ok(!events.some(e=>e.kind==='sound'&&e.data.kind==='item'));
    assert.equal(brain.lastNoise,null);
    sim.tick(use);
    assert.equal(p.hideExit,HIDE_EXIT_TICKS);
    for(let i=0;i<HIDE_EXIT_TICKS-1;i++) {
      sim.tick([key.forward,0,0,0,-1]);assert.equal(p.hidden,h.index);
    }
    Object.assign(brain.actor,{x:0,z:0});brain.spawnTime=10;
    sim.tick(idle);
    assert.equal(p.hidden,null);
    assert.ok(!sim.nav.blocked(p.x,p.z));
    assert.ok(Math.hypot(p.x-h.exit[0],p.z-h.exit[1])<.001);
  }
});

test('only a verified Granny opening emits the exact door event in single player',()=>{
  const events=[],sim=createSimulation(10,'normal',null,(kind,data)=>{if(kind==='grannyDoor')events.push(data.door);});
  const door=sim.world.doors.find(d=>d.name==='Study Door');
  sim.toggleDoor(door,true);assert.deepEqual(events,[]);
  sim.toggleDoor(door,false);
  const b=sim.state.brain;
  Object.assign(b.actor,{x:door.x-.55,z:door.z});
  Object.assign(b,{heading:Math.PI/2,state:'patrol',goal:[0,door.z],waypoints:[],repath:0,timer:5});
  for(let i=0;i<28&&!door.open;i++)sim.tick(idle);
  assert.equal(door.open,true);assert.deepEqual(events,[door.index]);
});

test('human Granny door alerts identify multiple doors, only reach Survivors and expire after five seconds',()=>{
  const room=roomFor('pvp'),hunter=room.members.find(p=>p.role==='granny'),survivor=room.members.find(p=>p.role==='survivor');
  const sim=createSimulation(1,'normal');
  const doors=sim.world.doors.filter(d=>['Study Door','Music Room Door','Bedroom Door'].includes(d.name));
  const [first,second,third]=doors;
  aim(hunter.body,first,first.x-.96,first.z);stepRoom(room,hunter,action.use);
  aim(hunter.body,second,second.x-.96,second.z);stepRoom(room,hunter,action.use);
  aim(survivor.body,third,third.x-1.1,third.z);stepRoom(room,survivor,action.use);
  const packet=viewMatch(room,survivor,0);
  assert.deepEqual(packet.doorAlerts.map(([i])=>i),[first.index,second.index]);
  assert.deepEqual(viewMatch(room,hunter,0).doorAlerts,[]);
  assert.ok(packet.world.find(([i])=>i===third.index)[1].open,'Survivor opened the third door');
  stepRoom(room,null,0,DOOR_ALERT_MS+100);
  assert.deepEqual(viewMatch(room,survivor,0).doorAlerts,[]);
});

test('a hidden Survivor can see outside without appearing in Granny’s view or attack results',()=>{
  for(const mode of ['pvp','coop']) {
    const room=roomFor(mode),[survivor,teammate]=room.members.filter(p=>p.role==='survivor');
    const hunter=room.members.find(p=>p.role==='granny');
    const h=createSimulation(1,'normal').world.hiding.find(o=>o.name==='Music Room Closet');
    aim(survivor.body,h,...h.exit);stepRoom(room,survivor,action.use);
    assert.equal(survivor.body.hidden,h.index);
    const [x,z]=h.exit,outside=[x,z-.55];
    Object.assign(teammate.body,{x:outside[0]-.35,z:outside[1]});
    assert.ok(viewMatch(room,survivor,0).mapTeam.some(p=>p.id===teammate.id));
    assert.ok(!viewMatch(room,teammate,0).mapTeam.some(p=>p.id===survivor.id));
    if(hunter) {
      aim(hunter.body,h,...outside);
      stepRoom(room,hunter,action.use);
      assert.equal(hunter.captures,0);
      assert.ok(!viewMatch(room,hunter,0).avatars.some(p=>p.id===survivor.id));
      assert.ok(viewMatch(room,survivor,0).avatars.some(p=>p.id===hunter.id));
    } else {
      const b=room.world.brain;
      Object.assign(b.actor,{x:outside[0],z:outside[1]});
      Object.assign(b,{spawnTime:0,state:'search',check:h.index,goal:outside,timer:3,repath:0});
      Object.assign(teammate.body,{x:0,z:5});
      stepRoom(room,null);
      assert.equal(room.world.objects.find(([i])=>i===h.index)[1].open,false);
      assert.ok(viewMatch(room,survivor,0).ai);
    }
    assert.equal(survivor.status,'active');assert.equal(survivor.body.hidden,h.index);
    stepRoom(room,survivor,action.use);
    assert.equal(survivor.body.hideExit,HIDE_EXIT_TICKS);
    for(let i=0;i<HIDE_EXIT_TICKS-1;i++)stepRoom(room,null);
    assert.equal(survivor.body.hidden,h.index);
    stepRoom(room,null);
    assert.equal(survivor.body.hidden,null);
  }
});

test('previous solo checkpoints load into the connected mansion with new doors closed',()=>{
  const sim=createSimulation(7,'normal',null,undefined,null,PRE_LAYOUT_RUN_VERSION);
  const state=JSON.parse(JSON.stringify(sim.snapshot()));
  assert.ok(validCheckpoint({version:CHECKPOINT_VERSION,difficulty:'normal',state}));
  const reopened=createSimulation(7,'normal',state);
  assert.equal(reopened.world.doors.find(d=>d.name==='Kitchen Cellar Door').open,false);
  assert.equal(reopened.state.player.x,sim.state.player.x);
});
