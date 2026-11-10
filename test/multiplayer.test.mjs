import test from 'node:test';
import assert from 'node:assert/strict';
import {advanceMatch,startMatch,acceptInput,newMember,viewMatch,MATCH_VERSION,skill} from '../dist/src/match.js';
import {action,createSimulation,key} from '../dist/src/simulation.js';
import worker from '../dist/server/index.js';
import {sqlite} from '../scripts/sqlite.mjs';

const origin='https://blackmere.test',start=100_000;
const create=(mode,count)=>{
  const members=Array.from({length:count},(_,i)=>newMember({id:String(i),username:'Player'+i},start));
  const room={mode,minutes:6,difficulty:'normal',members,chat:[],access:'private'};
  startMatch(room,start,100);
  return room;
};
function face(p,x,z) {p.yaw=Math.atan2(p.body.x-x,p.body.z-z);}
function at(p,x,z,yaw) {
  Object.assign(p.body,{x,z,yaw,pitch:0,hidden:null});p.yaw=yaw;p.pitch=0;
}
function tick(r,elapsed=34) {
  const now=r.clock+elapsed;
  for(const p of r.members)p.seen=now;
  advanceMatch(r,now);
}
function use(r,p,keys=0,actions=action.use) {
  acceptInput(p,{seq:p.seq+1,keys,yaw:Math.round(p.yaw*1000),pitch:Math.round(p.pitch*1000),actions,slot:-1});
  tick(r);
}

test('co-op shares both puzzle routes and preserves individual escapes',()=>{
  for(const route of ['front','drain']) {
    const r=create('coop',2),[a,b]=r.members;
    const sim=createSimulation(100,'normal');
    const find=(id)=>sim.world.objects.find(o=>o.id===id||o.name===id);
    const carry=(p,id)=>{
      const item=find(id);
      p.inventory.push(item.index);
      Object.assign(r.world.objects.find(([i])=>i===item.index)[1],{available:false,container:null});
    };
    const operate=(seat,o)=>{
      const client=createSimulation(100,'normal',JSON.parse(JSON.stringify(r.world)));
      for(const radius of [1.3,1.55,1.75]) for(let n=0;n<32;n++) {
        const theta=n*Math.PI/16,x=o.x+Math.sin(theta)*radius,z=o.z+Math.cos(theta)*radius;
        if(client.nav.blocked(x,z))continue;
        const yaw=Math.atan2(x-o.x,z-o.z),pitch=Math.atan2(o.y-(seat.body.eye??1.66),radius);
        at(seat,x,z,yaw);seat.body.pitch=seat.pitch=pitch;
        Object.assign(client.state.player,seat.body);
        if(client.target()?.index===o.index){use(r,seat);return;}
      }
      assert.fail('No valid interaction angle for '+o.name);
    };
    if(route==='front') {
      const door=find('Front Door');
      carry(a,'cutters');carry(b,'key');
      operate(a,door);assert.equal(r.world.progress.cut,true);
      operate(b,door);assert.equal(r.world.progress.unlock,true);
      operate(a,door);operate(b,door);
    } else {
      const box=find('Cellar Fuse Box'),gate=find('Drain Gate');
      carry(a,'fuse');carry(b,'crank');
      operate(a,box);assert.equal(r.world.progress.power,true);
      operate(b,gate);assert.equal(r.world.progress.handle,true);
      operate(a,gate);operate(b,gate);
    }
    assert.equal(a.objectives,1);assert.equal(b.objectives,1);
    assert.equal(a.status,'escaped');assert.equal(b.status,'escaped');
    assert.equal(r.winner,'survivors');
  }
});

test('Granny uses the same speed in the room simulation and in player snapshots',()=>{
  for(const legacy of [false,true]) {
    const r=create('pvp',2),[hunter]=r.members;
    if(legacy)delete r.physicsVersion;
    r.clock=r.started+7500;
    at(hunter,0,-3,0);
    use(r,hunter,key.forward,0);
    const expected=legacy?3.38:2.82;
    assert.equal(viewMatch(r,hunter,0).grannySpeed,expected);
    assert.ok(Math.abs((-3-hunter.body.z)*30-expected)<.001);
  }
});

test('Granny cannot attack through a wall, and a teammate can rescue a capture',()=>{
  const r=create('pvp',5),[hunter,a,b]=r.members;
  assert.equal(r.members.filter(p=>p.role==='granny').length,1);
  r.clock=r.started+7500;
  const world=createSimulation(100,'normal');
  at(hunter,-2.77,6.1,-Math.PI/2);at(a,-1.74,6.1,Math.PI/2);
  assert.ok(!world.nav.clear(hunter.body.x,hunter.body.z,a.body.x,a.body.z));
  use(r,hunter);
  assert.equal(a.status,'active');
  assert.equal(viewMatch(r,hunter,0).avatars.some(p=>p.id===a.id),false);
  at(hunter,0,-3,0);at(a,0,-4.1,Math.PI);at(b,.75,-4.4,0);face(b,0,-4.1);
  use(r,hunter);assert.equal(a.status,'active','attack cooldown');
  r.clock+=2000;
  use(r,hunter);assert.equal(a.status,'captured');
  assert.equal(hunter.captures,1);
  use(r,b);assert.equal(a.status,'active');assert.equal(b.rescues,1);
  r.clock+=1700;
  use(r,hunter);assert.equal(a.status,'active','brief protection after rescue');
  r.clock+=5000;
  at(a,0,-5.8,Math.PI);at(b,.75,-5.8,0);
  use(r,hunter,0,skill.trap);assert.equal(r.traps.length,1);
  use(r,hunter,0,skill.trap);assert.equal(r.traps.length,1);
  at(a,0,-3.7,Math.PI);tick(r);
  assert.equal(r.traps.length,0);assert.ok(a.slowUntil>r.clock);
});

test('the server validates lobby roles, invitations, movement packets and one result per match',async t=>{
  const db=sqlite();let now=Date.now();t.mock.method(Date,'now',()=>now);
  try {
    async function q(subject,path,data) {
      const headers={origin,'content-type':'application/json'};
      if(subject)headers['oai-authenticated-user-id']=subject;
      const r=await worker.fetch(new Request(origin+'/api/'+path,{headers,method:data?'POST':'GET',body:data?JSON.stringify(data):undefined}),{DB:db,PLATFORM_AUTH:'1'});
      const answer=await r.json();
      return {status:r.status,...answer};
    }
    const users=[];
    for(let i=0;i<6;i++)users.push((await q('p'+i,'profile',{username:'Tester'+i})).profile);
    await q('p0','friends',{target:users[1].id,action:'send'});
    await q('p1','friends',{target:users[0].id,action:'accept'});
    const created=await q('p0','multiplayer',{op:'create',mode:'pvp',access:'public',minutes:6,difficulty:'normal',voice:true});
    assert.equal(created.status,200);
    const code=created.code,path='multiplayer/'+code;
    assert.equal((await q('p0',path,{op:'invite',target:users[1].id})).status,200);
    assert.equal((await q('p1','multiplayer')).invites[0].code,code);
    assert.equal((await q('p2',path,{op:'touch'})).status,403);
    const join=(i)=>q('p'+i,'multiplayer',{op:'join',code});
    const seats=await Promise.all([1,2,3,4].map(join));
    assert.ok(seats.every(p=>p.status===200),JSON.stringify(seats.map(p=>p.status)));
    assert.equal((await join(5)).status,409);
    assert.equal((await q('p1',path,{op:'start'})).status,403);
    assert.equal((await q('p0',path,{op:'start'})).status,409);
    for(let i=0;i<5;i++)assert.equal((await q('p'+i,path,{op:'ready',ready:true,preference:i===0?'granny':'survivor'})).status,200);
    const r=await q('p0',path,{op:'start'});
    assert.equal(r.members.filter(p=>p.role==='granny').length,1);
    assert.equal(r.members.length,5);
    assert.ok(r.members.every(p=>!Object.hasOwn(p,'ticket')));
    let game=r.game;
    const send=(ticket,seq,keys=0)=>q(null,path+'/exchange',{version:MATCH_VERSION,ticket,game,
      seq,keys,yaw:-1571,pitch:0,actions:0,slot:-1,after:0});
    const voice=(subject,data={})=>q(subject,path+'/voice',{game,after:0,signals:[],...data});
    const v0=await voice('p0',{enabled:true}),v1=await voice('p1',{enabled:true});
    const offer={type:'offer',sdp:'v=0\r\nm=audio 9 UDP/TLS/RTP/SAVPF 111\r\n'};
    assert.equal((await voice('p0',{signals:[{to:users[1].id,version:v1.version,value:offer}]})).status,200);
    assert.equal((await voice('p1')).signals[0].from,users[0].id);
    assert.deepEqual((await voice('p3')).signals,[]);
    assert.ok(v0.version&&v1.version);
    now+=180;
    assert.equal((await send(crypto.randomUUID(),1)).status,403);
    assert.equal((await send(seats[0].ticket,1,32)).status,400);
    const initial=await send(seats[0].ticket,1,key.forward);
    assert.equal(initial.status,200);
    assert.ok(initial.avatars.every(p=>p.role==='survivor'));
    now+=230;
    const moved=await send(seats[0].ticket,2,key.forward);
    assert.ok(moved.me.x>initial.me.x+.3);
    now+=180;
    const reconnected=await q('p1','multiplayer',{op:'join',code});
    assert.equal(reconnected.game,r.game);
    assert.equal(reconnected.ticket,seats[0].ticket);
    async function timeout() {
      now+=42000;
      const saved=await db.prepare('SELECT state FROM multiplayer_rooms WHERE code=?').bind(code).first();
      const state=JSON.parse(saved.state);
      state.clock=now-120;state.deadline=now-40;
      for(const p of state.members)p.seen=now-180;
      await db.prepare('UPDATE multiplayer_rooms SET state=? WHERE code=?').bind(JSON.stringify(state),code).run();
    }
    await timeout();
    const finished=await send(r.ticket,1);
    assert.equal(finished.phase,'result');assert.equal(finished.winner,'granny');assert.equal(finished.ranked,true);
    now+=250;assert.equal((await send(r.ticket,1)).winner,'granny');
    const leaderboard=(await q('p0','multiplayer/rankings?role=granny')).rows;
    assert.equal(leaderboard[0].username,'Tester0');assert.equal(leaderboard[0].games,1);assert.equal(leaderboard[0].score,250);
    const stats=(await q('p1','multiplayer')).stats;
    assert.equal(stats[0].games,1);assert.equal(stats[0].escapes,0);
    assert.equal((await q('p0',path,{op:'rematch'})).phase,'lobby');
    for(let i=0;i<5;i++)await q('p'+i,path,{op:'ready',ready:true,preference:i===0?'granny':'survivor'});
    game=(await q('p0',path,{op:'start'})).game;
    await timeout();
    assert.equal((await send(r.ticket,1)).ranked,false);
    assert.equal((await q('p0','multiplayer/rankings?role=granny')).rows[0].score,250);
    assert.equal((await q('p0',path,{op:'rematch'})).phase,'lobby');
    await q('p2','friends',{target:users[0].id,action:'block'});
    assert.equal((await q('p0',path,{op:'invite',target:users[2].id})).status,403);
    const queue=(who)=>q(who,'multiplayer',{op:'quick',mode:'coop'});
    const queued=await queue('p4');
    assert.equal(queued.phase,'lobby');
    const matched=await queue('p5');
    assert.equal(matched.code,queued.code);
    assert.equal(matched.phase,'play');
    assert.ok(matched.members.every(p=>p.role==='survivor'));
  }finally{db.close();}
});
