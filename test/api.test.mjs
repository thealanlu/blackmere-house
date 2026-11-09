import test from 'node:test';
import assert from 'node:assert/strict';
import worker from '../dist/server/index.js';
import {sqlite} from '../scripts/sqlite.mjs';
import {play,pack} from './driver.mjs';
import {runScore,RUN_VERSION} from '../dist/src/rules.js';

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

test('password and verification flows use Supabase sessions, PKCE, and HttpOnly cookies',async(t)=>{
  const h=harness({SUPABASE_URL:'https://auth.invalid',SUPABASE_PUBLISHABLE_KEY:'test-publishable'});
  const user={id:'test-user',email_confirmed_at:'2026-01-01',user_metadata:{username:'Verified'}};
  const tokens={access_token:'test.access.jwt.abcdefgh',refresh_token:'test_refresh_012345678',expires_in:3600,user};
  const calls=[];
  t.mock.method(globalThis,'fetch',async (url,options)=>{
    assert.ok(url.startsWith('https://auth.invalid/'));
    const u=new URL(url),data=options.body?JSON.parse(options.body):null;
    calls.push([u.pathname,u.search,data]);
    if(u.pathname==='/auth/v1/signup'||u.pathname==='/auth/v1/recover')return Response.json({ok:true});
    if(u.pathname==='/auth/v1/token')return Response.json(tokens);
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
    const email='test@example.invalid',password='a-strong-test-password';
    assert.equal((await send('auth/signup',{email,password,username:'Verified'})).data.verification,true);
    assert.equal(calls[0][2].code_challenge_method,'s256');
    assert.ok(jar.has('bm_pkce'));
    assert.equal((await send('auth/session',{code:'invalid-looking-but-test'})).status,200);
    assert.ok(jar.has('bm_access'));
    assert.equal(jar.has('bm_pkce'),false);
    assert.equal((await send('profile',{username:'Verified'})).status,201);
    assert.equal((await send('auth/logout')).status,200);
    assert.equal(jar.has('bm_access'),false);
    assert.equal((await send('auth/login',{email,password})).data.signedIn,true);
    assert.equal((await send('auth/refresh')).data.signedIn,true);
    assert.equal((await send('auth/recover',{email})).data.sent,true);
    assert.equal((await send('auth/session',{code:'another-test-code'})).data.recovery,true);
    assert.equal((await send('auth/reset',{password})).data.updated,true);
    assert.equal(jar.has('bm_access'),false);
  }finally{h.DB.close();}
});
