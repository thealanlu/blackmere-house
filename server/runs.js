import {body,fail,json,one,write,statement,limit} from './http.js';
import {createSimulation,action} from '../dist/src/simulation.js';
import {levels,MAX_TICKS,PRE_EXPANSION_RUN_VERSION,PRE_LAYOUT_RUN_VERSION,PRE_SLOWDOWN_RUN_VERSION,RUN_VERSION,runScore} from '../dist/src/rules.js';

const maxBatch=240;
const validInt=(v,min,max)=>Number.isInteger(v)&&v>=min&&v<=max;
async function digest(value) {
  const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify(value)));
  return Array.from(new Uint8Array(bytes),x=>x.toString(16).padStart(2,'0')).join('');
}
function unpack(batch,max=maxBatch) {
  if(!Array.isArray(batch)||batch.length<1||batch.length>max)fail(400,'Invalid replay batch.');
  let total=0;
  for(const row of batch) {
    if(!Array.isArray(row)||row.length!==6)fail(400,'Invalid replay input.');
    const [n,keys,yaw,pitch,actions,slot]=row;
    if(!validInt(n,1,max)||!validInt(keys,0,31)||!validInt(yaw,-3200,3200)||!validInt(pitch,-2860,2860)||
      (!validInt(actions,0,159)||(actions&96)!==0)||!validInt(slot,-1,3)||(n>1&&(actions||slot!==-1)))fail(400,'Invalid replay input.');
    if((total+=n)>max)fail(400,'Replay batch is too long.');
  }
  return total;
}
export async function runs(request,env,url,profile) {
  if(!profile)fail(401,'Sign in and create a profile to play ranked.');
  if(request.method!=='POST')fail(405,'Use POST.');
  const db=env.DB,now=Date.now();
  if(url.pathname==='/api/runs') {
    await limit(db,'start:'+profile.id,8,5);
    const d=await body(request,800);
    if(!Object.hasOwn(levels,d.difficulty)||d.version!==RUN_VERSION)fail(409,'Reload the game before starting a ranked run.');
    const id=crypto.randomUUID(),seed=crypto.getRandomValues(new Uint32Array(1))[0],expires=now+90*60000;
    await db.batch([
      statement(db,"UPDATE runs SET status='abandoned',snapshot=NULL WHERE player=? AND status='active'",profile.id),
      statement(db,"DELETE FROM runs WHERE player=? AND status='abandoned' AND started_at<?",profile.id,now-86400000),
      statement(db,`INSERT INTO runs(id,player,difficulty,seed,version,started_at,expires_at,rules_difficulty) VALUES(?,?,?,?,?,?,?,?)`,
        id,profile.id,d.difficulty==='nightmare'?'dread':d.difficulty,seed,RUN_VERSION,now,expires,d.difficulty)
    ]);
    return json({id,seed,difficulty:d.difficulty,version:RUN_VERSION},201);
  }
  const match=/^\/api\/runs\/([0-9a-f-]{36})\/(step|cancel)$/.exec(url.pathname);
  if(!match)fail(404,'Run not found.');
  const [,id,operation]=match;
  if(operation==='cancel') {
    await limit(db,'cancel:'+profile.id,15);
    await write(db,"UPDATE runs SET status='abandoned',snapshot=NULL WHERE id=? AND player=? AND status='active'",id,profile.id);
    return json({ok:true});
  }
  await limit(db,'replay:'+profile.id,36);
  const d=await body(request,16000);
  const count=unpack(d.batch);
  if(!validInt(d.seq,0,MAX_TICKS+5))fail(400,'Invalid replay sequence.');
  const row=await one(db,'SELECT * FROM runs WHERE id=? AND player=?',id,profile.id);
  if(!row)fail(404,'Run not found.');
  if(row.expires_at<now||row.status==='abandoned'||![PRE_SLOWDOWN_RUN_VERSION,PRE_LAYOUT_RUN_VERSION,PRE_EXPANSION_RUN_VERSION,RUN_VERSION].includes(row.version))fail(409,'This ranked run expired.');
  const hash=await digest(d.batch);
  if(d.seq===row.seq-1&&row.last_hash===hash) {
    return json({seq:row.seq,result:row.status==='finished'?await one(db,'SELECT route,deaths,ticks,score FROM results WHERE run=?',id):null});
  }
  if(d.seq!==row.seq||row.status!=='active')fail(409,'This replay is out of order.');
  if(row.ticks+count>MAX_TICKS+5)fail(409,'Ranked runs have a 25-minute play limit.');
  if(row.ticks+count>Math.floor((now-row.started_at)/1000*30)+32)fail(422,'Replay arrived faster than the game clock.');
  const difficulty=row.rules_difficulty??row.difficulty;
  const sim=createSimulation(row.seed,difficulty,row.snapshot?JSON.parse(row.snapshot):null,undefined,null,row.version);
  for(const [n,...input] of d.batch) for(let i=0;i<n;i++) {
    const mode=sim.state.mode,wake=Boolean(input[3]&action.wake);
    if((mode==='interlude'&&!wake)||(mode!=='interlude'&&wake)||mode==='victory'||mode==='defeat')
      fail(422,'Replay contains inputs outside active play.');
    sim.tick(input);
  }
  const s=sim.state,done=s.mode==='victory'||s.mode==='defeat';
  if(s.tick>MAX_TICKS)fail(422,'Ranked runs have a 25-minute play limit.');
  const result=done?{route:s.route,deaths:s.route?s.day-1:5,ticks:s.tick,score:Math.min(4100,runScore(difficulty,s.tick,s.route?s.day-1:5,s.route))}:null;
  const update=statement(db,`UPDATE runs SET seq=seq+1,last_hash=?,snapshot=?,status=?,ticks=?
    WHERE id=? AND player=? AND seq=? AND status='active'`,hash,done?null:JSON.stringify(sim.snapshot()),done?'finished':'active',s.tick,id,profile.id,row.seq);
  const changes=done?await db.batch([update,statement(db,`INSERT OR IGNORE INTO results(run,player,finished_at,route,deaths,ticks,score)
    SELECT id,player,?,?,?,?,? FROM runs WHERE id=? AND seq=? AND last_hash=? AND status='finished' AND changes()=1`,
    now,result.route,result.deaths,result.ticks,result.score,id,row.seq+1,hash)]):[await update.run()];
  if(changes[0].meta.changes!==1)fail(409,'The replay changed. Try again.');
  return json({seq:row.seq+1,result});
}

export async function offlineRecord(request,db,profile) {
  if(!profile)fail(401,'Sign in to sync your personal record.');
  const player=profile.id;
  if(request.method==='POST') {
    await limit(db,'offline-replay:'+player,8,5);
    const d=await body(request,1_600_000);
    if(d.owner!==undefined&&d.owner!==player)fail(409,'The signed-in account changed. Sync again from your record.');
    if(typeof d.id!=='string'||!/^[0-9a-f-]{36}$/.test(d.id)||d.version!==RUN_VERSION||
      !Object.hasOwn(levels,d.difficulty)||!validInt(d.seed,0,4294967295))fail(422,'This run cannot be verified.');
    if(await one(db,'SELECT 1 FROM offline_escapes WHERE player=? AND run=?',player,d.id))return json({ok:true});
    unpack(d.rows,MAX_TICKS+5);
    const fingerprint=await digest([d.version,d.difficulty,d.seed,d.rows]);
    if(await one(db,'SELECT 1 FROM offline_escapes WHERE player=? AND replay_hash=?',player,fingerprint))return json({ok:true});
    const sim=createSimulation(d.seed,d.difficulty);
    for(const [n,...input] of d.rows)for(let i=0;i<n;i++){
      const mode=sim.state.mode,wake=Boolean(input[3]&action.wake);
      if((mode==='interlude')!==wake||!['play','interlude'].includes(mode))fail(422,'The replay contains inputs outside active play.');
      sim.tick(input);
    }
    const {mode,route,tick}=sim.state;
    if(mode!=='victory'||tick>MAX_TICKS)fail(422,'This replay did not verify an escape.');
    await write(db,'INSERT OR IGNORE INTO offline_escapes(player,run,difficulty,route,ticks,replay_hash) VALUES (?,?,?,?,?,?)',
      player,d.id,d.difficulty,route,tick,fingerprint);
    return json({ok:true});
  }
  if(request.method!=='GET')fail(405,'Use GET or POST.');
  const record=await one(db,`SELECT COUNT(*) AS escapes,MAX(route='front') AS front,MAX(route='drain') AS drain,
    MAX(difficulty='nightmare') AS nightmare FROM offline_escapes WHERE player=?`,player);
  return json(record);
}
