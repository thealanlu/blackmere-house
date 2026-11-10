import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {sqlite} from '../scripts/sqlite.mjs';
import {createSimulation,key,action} from '../dist/src/simulation.js';
import {RUN_VERSION} from '../dist/src/rules.js';
import {movementBits,aimAxis} from '../dist/src/input.js';
import {adaptiveResolution,pixelRatio,presets,recommendedPreset} from '../dist/src/performance.js';
import {normalizePreferences} from '../dist/src/preferences.js';
import {validCheckpoint} from '../dist/src/checkpoint.js';

test('touch sectors and controller dead zones produce the existing movement protocol',()=>{
  assert.equal(movementBits(0,-.1),0);
  assert.equal(movementBits(0,-.82),key.forward);
  assert.equal(movementBits(-.6,-.6),key.forward|key.left);
  assert.equal(movementBits(.9,.4),key.right|key.back);
  assert.equal(aimAxis(.1),0);assert.equal(aimAxis(-1),-1);
  const p=normalizePreferences({joystickSize:5,frameRate:'bogus',graphics:'high'},true);
  assert.equal(p.joystickSize,1.32);assert.equal(p.frameRate,'auto');assert.equal(p.graphics,'high');assert.equal(p.motion,false);
});

test('automatic quality and resolution limits reduce expensive rendering on constrained devices',()=>{
  assert.equal(recommendedPreset({coarse:true,memory:3,cores:8}),'low');
  assert.equal(recommendedPreset({coarse:true,memory:8,cores:8}),'medium');
  assert.equal(recommendedPreset({coarse:false,texture:2048}),'low');
  assert.equal(recommendedPreset({coarse:false,texture:16384}),'high');
  const ratio=pixelRatio(presets.low,1920,1080,2);
  assert.ok(1920*1080*ratio*ratio<=presets.low.pixels+1);
  const adaptive=adaptiveResolution();
  for(let i=0;i<90;i++)adaptive.sample(34,16.67,18);
  assert.ok(adaptive.scale<.83);
  const lower=adaptive.scale;
  for(let i=0;i<400;i++)adaptive.sample(16.67,16.67,8);
  assert.ok(adaptive.scale>lower);
});

test('cloud settings and solo checkpoints are account-scoped and use save revisions',async()=>{
  const DB=sqlite(),origin='https://blackmere.test';
  const q=async(subject,path,data)=>{
    const headers={origin,'content-type':'application/json'};
    if(subject)headers['oai-authenticated-user-id']=subject;
    const response=await worker.fetch(new Request(origin+'/api/'+path,{method:data?'POST':'GET',headers,
      body:data?JSON.stringify(data):undefined}),{DB,PLATFORM_AUTH:'1'});
    return {status:response.status,...await response.json()};
  };
  try {
    await q('a','profile',{username:'FirstDevice'});await q('b','profile',{username:'SecondDevice'});
    assert.equal((await q(null,'checkpoint')).status,401);
    assert.equal((await q('a','preferences',{volume:.4,graphics:'ultra'})).status,200);
    assert.equal((await q('a','preferences',{invertY:true,brightness:1.3})).status,200);
    assert.equal((await q('a','preferences',{volume:2})).status,400);
    assert.deepEqual((await q('a','preferences')).preferences,{volume:.4,invertY:true,brightness:1.3});
    assert.deepEqual((await q('b','preferences')).preferences,{});
    const sim=createSimulation(36,'story');
    for(let i=0;i<45;i++)sim.tick([key.forward,0,0,0,-1]);
    sim.tick([0,0,0,action.crouch,-1]);
    const checkpoint=JSON.parse(JSON.stringify({version:RUN_VERSION,difficulty:'story',state:sim.snapshot()}));
    assert.ok(validCheckpoint(checkpoint));
    assert.equal((await q('a','checkpoint',{revision:0,checkpoint})).revision,1);
    const saved=await q('a','checkpoint');
    assert.equal(saved.revision,1);
    const restored=createSimulation(0,'story',saved.checkpoint.state);
    assert.equal(restored.state.player.x,sim.state.player.x);assert.ok(restored.state.player.crouch);
    assert.equal((await q('b','checkpoint')).checkpoint,null);
    assert.equal((await q('a','checkpoint',{revision:0,checkpoint:null})).status,409);
    checkpoint.state.objects.push([999,{open:true}]);
    assert.equal((await q('a','checkpoint',{revision:1,checkpoint})).status,400);
    assert.equal((await q('a','checkpoint',{revision:1,checkpoint:null})).revision,2);
    assert.equal((await q('a','checkpoint')).checkpoint,null);
  }finally{DB.close();}
});
