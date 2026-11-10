import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {sqlite} from '../scripts/sqlite.mjs';
import {play,pack} from './driver.mjs';
import {runScore,PRE_SLOWDOWN_RUN_VERSION,RUN_VERSION} from '../dist/src/rules.js';
import {createSimulation} from '../dist/src/simulation.js';

const origin='https://blackmere.test';
function harness(options={}) {
  const DB=sqlite();
  const env={DB,PLATFORM_AUTH:'1',...options};
  async function request(path,{method='GET',data,subject,cookie,from=origin}={}) {
    const headers={origin:from,'content-type':'application/json'};
    if(subject)headers['oai-authenticated-user-id']=subject;
    if(cookie)headers.cookie=cookie;
    const r=await worker.fetch(new Request(origin+'/api/'+path,{method,headers,body:data?JSON.stringify(data):undefined}),env);
    return {status:r.status,data:await r.json(),cookies:r.headers.getSetCookie()};
  }
  return {DB,request};
}
test('profile, friendship, privacy, blocking and deletion use real independent database records',async()=>{
  const h=harness(),{request:q}=h;
  try{
    const post=(path,subject,data)=>q(path,{subject,method:'POST',data});
    const a=(await post('profile','a',{username:'Caretaker'})).data.profile;
    assert.equal((await post('profile','b',{username:'caretaker'})).status,409);
    const b=(await post('profile','b',{username:'Lantern'})).data.profile;
    assert.equal((await post('profile','b',{username:'Duplicate'})).status,409);
    assert.equal((await q('players?q=Lan',{subject:'a'})).data.players[0].id,b.id);
    const friend=(subject,target,action)=>post('friends',subject,{target,action});
    assert.equal((await friend('a',b.id,'send')).status,200);
    assert.equal((await friend('a',b.id,'accept')).status,409);
    assert.equal((await q('me',{subject:'b'})).data.notifications,1);
    assert.equal((await friend('b',a.id,'decline')).status,200);
    assert.equal((await friend('a',b.id,'send')).status,200);
    assert.equal((await friend('a',b.id,'cancel')).status,200);
    assert.equal((await friend('a',b.id,'send')).status,200);
    assert.equal((await friend('b',a.id,'accept')).status,200);
    assert.equal((await q('friends',{subject:'a'})).data.friends[0].relationship,'accepted');
    assert.equal((await q('profile',{subject:'b',method:'PATCH',data:{username:'Lantern',visibility:'friends',allowRequests:false}})).status,200);
    assert.equal((await q('profile/'+b.id)).status,404);
    assert.equal((await q('profile/'+b.id,{subject:'a'})).status,200);
    assert.equal((await friend('a',b.id,'remove')).status,200);
    assert.equal((await q('profile/'+b.id,{subject:'a'})).status,404);
    assert.equal((await friend('a',b.id,'send')).status,409);
    assert.equal((await friend('b',a.id,'block')).status,200);
    assert.equal((await q('profile/'+a.id,{subject:'b'})).status,404);
    assert.equal((await friend('b',a.id,'unblock')).status,200);
    assert.equal((await q('profile/'+a.id,{subject:'b'})).status,200);
    assert.equal((await q('profile',{subject:'b',method:'DELETE',data:{confirm:'Lantern'},from:'https://evil.invalid'})).status,403);
    assert.equal((await q('profile',{subject:'b',method:'DELETE',data:{confirm:'Lantern'}})).status,200);
    assert.equal((await q('me',{subject:'b'})).data.profile,null);
  }finally{h.DB.close();}
});

test('server rejects impossible submissions and records only the replay-verified score',async(t)=>{
  let now=Date.now();
  t.mock.method(Date,'now',()=>now);
  const h=harness(),{request:q,DB}=h;
  try{
    const profile=(await q('profile',{subject:'runner',method:'POST',data:{username:'Runner'}})).data.profile;
    const start=(await q('runs',{subject:'runner',method:'POST',data:{difficulty:'story',version:RUN_VERSION}})).data;
    const step=(data,subject='runner')=>q('runs/'+start.id+'/step',{subject,method:'POST',data});
    assert.equal((await step({seq:0,score:999999,route:'front'})).status,400);
    assert.equal((await step({seq:0,batch:[[240,0,0,0,0,-1]]})).status,422);
    assert.equal((await step({seq:0,batch:[[1,0,0,0,16,-1]]})).status,422);
    await q('profile',{subject:'other',method:'POST',data:{username:'Other'}});
    assert.equal((await step({seq:0,batch:[[1,0,0,0,0,-1]]},'other')).status,404);
    // Set only the server-issued seed in the isolated test database. The player's commands and the result both come from the game.
    await DB.prepare('UPDATE runs SET seed=? WHERE id=?').bind(100,start.id).run();
    const {log,sim}=play(100,'story','front'), batches=pack(log);
    let result;
    for(let seq=0;seq<batches.length;seq++){
      now+=6500;
      const response=await step({seq,batch:batches[seq]});
      assert.equal(response.status,200,JSON.stringify(response.data));
      result=response.data.result;
    }
    assert.equal(result.route,'front');
    assert.equal(result.ticks,sim.state.tick);
    assert.equal(result.score,runScore('story',sim.state.tick,0,'front'));
    const retry=await step({seq:batches.length-1,batch:batches.at(-1)});
    assert.equal(retry.status,200);
    assert.equal(retry.data.result.score,result.score);
    const board=(await q('leaderboard?metric=score&period=month&q=run',{subject:'runner'})).data;
    assert.equal(board.results[0].id,profile.id);
    assert.equal(board.personal.rank,1);
    assert.equal((await q('leaderboard?metric=fastest')).data.results[0].best,result.ticks);
    assert.equal((await q('leaderboard?metric=rate')).data.results.length,0);
    assert.equal((await q('me',{subject:'runner'})).data.stats.games,1);
  }finally{DB.close();}
});

test('an in-progress ranked replay retains the Granny speed it started with',async(t)=>{
  let now=Date.now();
  t.mock.method(Date,'now',()=>now);
  const {request,DB}=harness();
  const post=(path,data)=>request(path,{subject:'runner',method:'POST',data});
  try {
    await post('profile',{username:'Runner'});
    const run=(await post('runs',{difficulty:'normal',version:RUN_VERSION})).data;
    await DB.prepare('UPDATE runs SET version=? WHERE id=?').bind(PRE_SLOWDOWN_RUN_VERSION,run.id).run();
    const input=[0,0,0,0,-1];
    const old=createSimulation(run.seed,'normal',null,undefined,null,PRE_SLOWDOWN_RUN_VERSION);
    const current=createSimulation(run.seed,'normal');
    for(let i=0;i<120;i++){old.tick(input);current.tick(input);}
    assert.ok(old.state.brain.actor.x>current.state.brain.actor.x+.5);
    now+=4500;
    assert.equal((await post('runs/'+run.id+'/step',{seq:0,batch:[[120,...input]]})).status,200);
    const {snapshot}=await DB.prepare('SELECT snapshot FROM runs WHERE id=?').bind(run.id).first();
    assert.deepEqual(JSON.parse(snapshot).brain.actor,old.state.brain.actor);
  } finally {DB.close();}
});

test('gamer-tag signup signs in immediately and login follows a renamed tag',async(t)=>{
  const h=harness({SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'test-publishable'});
  const user={id:'test-user'};
  const tokens={access_token:'test.access.jwt.abcdefgh',refresh_token:'test_refresh_012345678',expires_in:3600,user};
  const password='a-strong-test-password';
  const paths=[];
  t.mock.method(globalThis,'fetch',async(url,options)=>{
    assert.ok(url.startsWith('https://auth.invalid/'));
    assert.equal(options.redirect,'manual');
    const u=new URL(url),data=options.body?JSON.parse(options.body):null;
    paths.push(u.pathname);
    if(u.pathname==='/auth/v1/signup') {
      assert.match(data.email,/^bh-[a-f0-9-]{36}@blackmere\.invalid$/);
      assert.equal(data.password,password);
      assert.equal(data.code_challenge,undefined);
      user.email=data.email;
      return Response.json(tokens);
    }
    if(u.pathname==='/auth/v1/token') {
      if(u.searchParams.get('grant_type')==='password') {
        assert.equal(data.email,user.email);
        if(data.password!==password)return Response.json({error_code:'invalid_credentials'},{status:400});
      }else assert.equal(data.refresh_token,tokens.refresh_token);
      return Response.json(tokens);
    }
    if(u.pathname==='/auth/v1/user')return Response.json(user);
    return Response.json(null);
  });
  const jar=new Map();
  const send=async(path,data,method='POST')=>{
    const r=await h.request(path,{method,data,cookie:[...jar].map(x=>x.join('=')).join('; ')});
    for(const set of r.cookies) {
      const [name,value]=set.split(';')[0].split('=');
      if(value)jar.set(name,value);else jar.delete(name);
      assert.match(set,/HttpOnly/);assert.match(set,/Secure/);
    }
    return r;
  };
  try {
    const create=await send('auth/signup',{username:'Lantern42',password});
    assert.equal(create.status,200);
    assert.deepEqual(create.data,{signedIn:true});
    assert.ok(jar.has('bm_access'));
    const me=(await send('me',undefined,'GET')).data;
    assert.equal(me.profile.username,'Lantern42');
    assert.equal(me.profile.password_login,undefined);
    assert.equal((await send('auth/signup',{username:'lantern42',password})).status,409);
    assert.equal((await send('profile',{username:'Lantern43',visibility:'public',allowRequests:true},'PATCH')).status,200);
    assert.equal((await send('auth/logout')).status,200);
    assert.equal(jar.has('bm_access'),false);
    assert.equal((await send('auth/login',{username:'Lantern42',password})).status,401);
    assert.equal((await send('auth/login',{username:'Lantern43',password:'wrong-password'})).status,401);
    assert.equal((await send('auth/login',{username:'lantern43',password})).data.signedIn,true);
    assert.equal((await send('auth/refresh')).data.signedIn,true);
    assert.equal((await send('auth/recover',{})).status,404);
    assert.equal((await send('auth/session',{})).status,404);
    assert.equal((await send('profile',{confirm:'Lantern43'},'DELETE')).status,200);
    assert.equal((await send('auth/login',{username:'Lantern43',password})).status,401);
    assert.equal(paths.filter(p=>p==='/auth/v1/signup').length,1);
    assert.ok(paths.includes('/rest/v1/rpc/blackmere_delete_my_account'));
  }finally{h.DB.close();}
});
