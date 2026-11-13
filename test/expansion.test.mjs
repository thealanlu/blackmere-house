import test from 'node:test';
import assert from 'node:assert/strict';
import {action,createSimulation,key} from '../dist/src/simulation.js';
import {newMember,startMatch,advanceMatch,acceptInput,viewMatch} from '../dist/src/match.js';
import {batterySeconds,floorY,floorAt,hasMap,stalkerSettings,RUN_VERSION,TICK} from '../dist/src/rules.js';
import {stairs,wingRooms} from '../dist/src/floors.js';
import {validCheckpoint,CHECKPOINT_VERSION} from '../dist/src/checkpoint.js';

const idle=[0,0,0,0,-1];
const command=actions=>[0,0,0,actions,-1];
function aim(body,o,x,z) {
  const eye=floorY(x,z)+1.66;
  Object.assign(body,{x,z,eye,yaw:Math.atan2(x-o.x,z-o.z),pitch:Math.atan2(o.y-eye,Math.hypot(x-o.x,z-o.z))});
}
function withTools(difficulty='normal') {
  const sim=createSimulation(33,difficulty);
  sim.state.brain.spawnTime=1e4;
  return sim;
}
function roomFor(mode,difficulty) {
  const members=Array.from({length:mode==='pvp'?3:2},(_,i)=>newMember({id:String(i),username:'Player'+i},100_000));
  const room={mode,difficulty,members,minutes:8,access:'private'};
  startMatch(room,100_000,42);
  room.clock=107_600;
  return room;
}
function step(room,seat,actions) {
  const now=room.clock+34;
  for(const member of room.members)member.seen=now;
  if(seat)acceptInput(seat,{seq:seat.seq+1,keys:0,yaw:Math.round(seat.body.yaw*1000),pitch:Math.round(seat.body.pitch*1000),actions,slot:-1});
  advanceMatch(room,now);
}

test('all four main stairways support continuous movement and AI pathfinding',()=>{
  const sim=withTools();
  const p=sim.state.player;
  for(const ramp of stairs.filter(s=>!s.secret)) {
    Object.assign(p,{x:ramp.x0-.4,z:ramp.z,yaw:-Math.PI/2,eye:ramp.y+1.66});
    const route=sim.nav.path(p.x,p.z,ramp.x1+.45,ramp.z);
    assert.ok(route.length>12);
    for(let i=0;i<220&&p.x<ramp.x1+.4;i++) {
      const before=p.eye;
      sim.tick([key.forward,0,0,0,-1]);
      assert.ok(Math.abs(p.eye-before)<.09,'stair walking changes eye height smoothly');
    }
    assert.equal(floorAt(p.x,p.z),ramp.to);
    assert.ok(p.x>=ramp.x1);
    assert.ok(Math.abs(floorY(p.x,p.z)-(ramp.y+3.4))<.01);
  }
  const secret=stairs.find(s=>s.secret),bookcase=sim.world.doors.find(d=>d.name==='Attic Bookcase');
  assert.equal(sim.nav.clear(secret.x0+.5,secret.z,secret.x1+.5,secret.z,.23),false);
  sim.toggleDoor(bookcase,true);
  assert.equal(sim.nav.clear(secret.x0+.5,secret.z,secret.x1+.5,secret.z,.23),true);
  assert.ok(sim.nav.blocked(19,3),'open space between stairs has no walkable surface');
  assert.ok(sim.nav.path(-7.7,-9,52,-4).length>90,'Granny can route from spawn to attic');
  const visited=new Set();
  const hunt=createSimulation(42,'nightmare');
  for(let i=0;i<6900;i++) {
    hunt.tickHouse([]);
    visited.add(floorAt(hunt.state.brain.actor.x,hunt.state.brain.actor.z));
  }
  assert.deepEqual([...visited].sort(),['attic','cellar','main','upper']);
  assert.ok(wingRooms.every(room=>sim.nav.path(-7.7,-9,(room.x0+room.x1)/2,(room.z0+room.z1)/2).length));
});

test('battery depletion follows gameplay time and a spare refills exactly once',()=>{
  for(const difficulty of ['normal','nightmare']) {
    const sim=withTools(difficulty),s=sim.state;
    const drain=TICK/batterySeconds(difficulty);
    for(let i=0;i<180;i++)sim.tick(idle);
    assert.ok(Math.abs(s.charge-(1-180*drain))<1e-10);
    sim.tick(command(action.light));
    const saved=s.charge;
    for(let i=0;i<180;i++)sim.tick(idle);
    assert.equal(s.charge,saved);
    s.charge=2*drain;
    sim.tick(command(action.light));sim.tick(idle);
    assert.equal(s.charge,0);assert.equal(s.flash,false);
    sim.tick(command(action.light));assert.equal(s.flash,false);
    const battery=sim.world.items.find(o=>o.id==='battery'&&o.available);
    battery.available=false;s.inventory.push(battery.index);
    sim.tick(command(action.reload));
    assert.equal(s.charge,1);assert.deepEqual(s.inventory,[]);
    sim.tick(command(action.reload));assert.equal(s.charge,1);
    assert.equal(sim.world.items.filter(o=>o.id==='battery'&&o.available).length,difficulty==='normal'?5:2);
  }
});

test('the server removes all map data in Nightmare and shares battery pickups once',()=>{
  for(const mode of ['pvp','coop']) {
    const room=roomFor(mode,'nightmare');
    const survivors=room.members.filter(p=>p.role==='survivor'),[first,second]=survivors;
    const sim=createSimulation(0,'nightmare',room.world);
    const door=sim.world.doors.find(o=>o.name==='Study Door');
    room.doorAlerts[door.index]=room.clock;
    for(const member of room.members) {
      const packet=viewMatch(room,member,0);
      assert.equal(packet.difficulty,'nightmare');assert.equal('mapTeam' in packet||'doorAlerts' in packet,false);
    }
    const battery=sim.world.items.find(o=>o.id==='battery'&&o.available);
    let place;
    for(let i=0;i<24;i++) {
      const angle=i*Math.PI/12,x=battery.x+1.30*Math.cos(angle),z=battery.z+1.3*Math.sin(angle);
      if(sim.nav.blocked(x,z))continue;
      aim(sim.state.player,battery,x,z);
      if(sim.target()?.index===battery.index){place=[x,z];break;}
    }
    assert.ok(place,'the spare battery has an accessible pickup point');
    aim(first.body,battery,...place);aim(second.body,battery,...place);
    step(room,first,action.use);step(room,second,action.use);
    assert.equal(first.inventory.filter(i=>i===battery.index).length,1);
    assert.equal(second.inventory.length,0);
    first.charge=.2;second.charge=.63;first.flash=false;second.flash=false;
    step(room,first,action.reload);
    assert.equal(first.charge,1);assert.equal(second.charge,.63);
    assert.equal(viewMatch(room,first,0).me.charge,1);
    assert.equal(viewMatch(room,second,0).me.charge,.63);
  }
  assert.deepEqual(['story','normal','dread','nightmare'].map(hasMap),[true,true,true,false]);
  assert.ok(stalkerSettings('nightmare',RUN_VERSION).chase>stalkerSettings('dread',RUN_VERSION).chase);
});

test('Nightmare requires the upstairs escape parts and keeps an upper wardrobe safe',()=>{
  const sim=withTools('nightmare'),s=sim.state;
  const front=sim.world.doors.find(o=>o.kind==='front');
  const spindle=sim.world.items.find(o=>o.id==='spindle');
  const relay=sim.world.items.find(o=>o.id==='relay');
  const lock=sim.world.objects.find(o=>o.kind==='fusebox');
  assert.equal(floorAt(spindle.x,spindle.z),'attic');assert.equal(floorAt(relay.x,relay.z),'upper');
  s.progress.cut=true;
  s.inventory.push(sim.world.items.find(o=>o.id==='key').index);
  aim(s.player,front,0,11.61);
  sim.tick(command(action.use));
  assert.equal(s.progress.unlock,false);
  s.inventory.push(spindle.index);
  sim.tick(command(action.use));sim.tick(command(action.use));
  assert.equal(s.progress.spindle,true);assert.equal(s.progress.unlock,true);
  s.inventory.push(sim.world.items.find(o=>o.id==='fuse').index);
  aim(s.player,lock,11.9,-11.36);
  sim.tick(command(action.use));assert.equal(s.progress.power,false);
  s.inventory.push(relay.index);
  sim.tick(command(action.use));sim.tick(command(action.use));assert.equal(s.progress.power,true);
  const cover=sim.world.hiding.find(o=>o.name==='East Bedroom Wardrobe');
  aim(s.player,cover,...cover.exit);s.flash=true;
  sim.tick(command(action.use));
  assert.equal(s.player.hidden,cover.index);assert.equal(s.flash,false);
  const battery=s.charge;
  Object.assign(s.brain.actor,{x:cover.peek[0],z:cover.peek[1]});
  s.brain.spawnTime=0;
  for(let i=0;i<45;i++)sim.tick(command(action.light));
  assert.equal(s.mode,'play');assert.equal(s.player.hidden,cover.index);
  assert.equal(s.charge,battery);assert.equal(s.flash,false);
  assert.equal(validCheckpoint({version:CHECKPOINT_VERSION,difficulty:'nightmare',state:sim.snapshot()}),true);
});
