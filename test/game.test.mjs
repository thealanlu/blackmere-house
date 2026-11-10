import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,key,action} from '../dist/src/simulation.js';
import {createStalker} from '../dist/src/stalker.js';
import {TICK} from '../dist/src/rules.js';
import {play} from './driver.mjs';

test('both escape routes work through collision, controls and objective actions',()=>{
  for(const [route,seed] of [['front',100],['front',987654321],['drain',100],['drain',987654321]]) {
    const {log,sim}=play(seed,'story',route);
    assert.equal(sim.state.route,route);
    let replay=createSimulation(seed,'story');
    for(let i=0;i<log.length;i++){
      if(i%145===0)replay=createSimulation(seed,'story',JSON.parse(JSON.stringify(replay.snapshot())));
      replay.tick(log[i]);
    }
    assert.equal(replay.state.route,route);
    assert.equal(replay.state.tick,sim.state.tick);
  }
});

test('the bedroom door stops movement and opens at eye level',()=>{
  const sim=createSimulation(121,'normal');
  for(let i=0;i<130;i++)sim.tick([key.forward,0,0,0,-1]);
  assert.ok(sim.state.player.x<-2.45);
  assert.equal(sim.prompt(),'Open door');
  sim.tick([0,0,0,action.use,-1]);
  for(let i=0;i<30;i++)sim.tick([key.forward,0,0,0,-1]);
  assert.ok(sim.state.player.x>-2);
});

test('the Caretaker can catch the player and exhaust all five nights',()=>{
  const sim=createSimulation(18,'dread');
  // Wait at a genuine patrol crossing, then return through the game’s wake action.
  for(let day=1;day<=5;day++) {
    const p=sim.state.player,brain=sim.state.brain;
    for(let i=0;i<500;i++)sim.tick([0,0,0,0,-1]);
    let point=null;
    for(let i=0;i<24;i++) {
      const angle=i*Math.PI/12,x=brain.actor.x+.63*Math.cos(angle),z=brain.actor.z+.63*Math.sin(angle);
      if(!sim.nav.blocked(x,z)&&sim.nav.clear(x,z,brain.actor.x,brain.actor.z)){point=[x,z];break;}
    }
    assert.ok(point);
    [p.x,p.z]=point;
    sim.tick([0,0,0,0,-1]);
    assert.equal(sim.state.mode,day===5?'defeat':'interlude');
    if(day<5)sim.tick([0,0,0,action.wake,-1]);
  }
});

test('repeated noise redirects an investigation without stopping her or making blocked footfalls',()=>{
  const sim=createSimulation(18,'normal'),brain={actor:{}},steps=[];
  const enemy=createStalker(sim.world,sim.nav,brain,()=>.5,(kind,at)=>steps.push({kind,...at}),()=>{},()=>{});
  enemy.reset('normal',1);
  brain.spawnTime=0;
  const listener={x:0,z:0,hidden:true};
  for(let i=0;i<70;i++) {
    if(i%8===0)enemy.hear(-5-i*.008,-9,7);
    enemy.update(TICK,listener);
  }
  assert.ok(brain.actor.x>-5.9);
  assert.ok(steps.length>1);
  assert.deepEqual(steps.slice(0,2).map(step=>step.foot),[1,0]);
  const count=steps.length,stride=brain.stride;
  sim.nav.move=()=>{};
  for(let i=0;i<50;i++) {
    enemy.hear(-3.5,-9,7);
    enemy.update(TICK,listener);
  }
  assert.equal(brain.pace,0);
  assert.equal(brain.stride,stride);
  assert.equal(steps.length,count);
});

test('patrolling opens the door on her route, then waits for it to swing',()=>{
  const sim=createSimulation(18,'normal'),brain={actor:{}},opened=[];
  const enemy=createStalker(sim.world,sim.nav,brain,()=>.5,()=>{},door=>{
    opened.push(door);door.open=true;door.blocker.enabled=false;
  },()=>{});
  enemy.reset('normal',1);
  const door=sim.world.doors.find(o=>o.x===-2.25&&o.z===-8.7);
  Object.assign(brain.actor,{x:door.x-.53,z:door.z});
  brain.goal=[door.x-.53,door.z+2];brain.heading=0;
  const hidden={x:0,z:0,hidden:true};
  for(let i=0;i<8;i++)enemy.update(TICK,hidden);
  assert.deepEqual(opened,[]);
  Object.assign(brain.actor,{x:door.x-.55,z:door.z});
  brain.goal=[0,door.z];brain.heading=Math.PI/2;brain.repath=0;
  for(let i=0;i<12&&!opened.length;i++)enemy.update(TICK,hidden);
  assert.deepEqual(opened,[door]);
  const before={...brain.actor};
  for(let i=0;i<5;i++)enemy.update(TICK,hidden);
  assert.deepEqual(brain.actor,before);
  for(let i=0;i<30;i++)enemy.update(TICK,hidden);
  assert.ok(brain.actor.x>door.x+.35);
});

test('losing sight sends her to the last sighting before she searches',()=>{
  const sim=createSimulation(18,'normal'),brain={actor:{}};
  const enemy=createStalker(sim.world,sim.nav,brain,()=>.5,()=>{},()=>{},()=>{});
  enemy.reset('normal',1);brain.spawnTime=0;
  Object.assign(brain.actor,{x:0,z:-5});
  brain.heading=0;brain.goal=[0,3];
  for(let i=0;i<16;i++)enemy.update(TICK,{x:0,z:0,hidden:false});
  assert.equal(brain.state,'chase');
  assert.deepEqual(brain.remembered,[0,0]);
  const unseen={x:6,z:-4,hidden:true};
  for(let i=0;i<90&&brain.state==='chase';i++)enemy.update(TICK,unseen);
  assert.equal(brain.state,'search');
  assert.ok(Math.hypot(brain.actor.x,brain.actor.z)<.6);
  assert.deepEqual(brain.remembered,[0,0]);
});
