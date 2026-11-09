import test from 'node:test';
import assert from 'node:assert/strict';
import {createSimulation,key,action} from '../dist/src/simulation.js';
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
