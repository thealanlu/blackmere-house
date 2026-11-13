import {body,fail,json,limit,many,one,statement,write} from './http.js';
import {levels} from '../dist/src/rules.js';
import {MATCH_VERSION,durations,graceMs,preferences,newMember,livingRoom,startMatch,acceptInput,advanceMatch,viewMatch} from '../dist/src/match.js';

const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const codePattern=/^[A-HJ-NP-Z2-9]{6}$/;
const uuidPattern=/^[a-f0-9-]{36}$/;
const maxAge=60*60_000;
const minPlayers=2;
const capacity=mode=>mode==='pvp'?5:4;
const gameMode=value=>value==='pvp'||value==='coop';
const accessModes=['private','public'];
const reasons=['Harassment','Cheating','Inappropriate chat'];
const valid=(n,a,b)=>Number.isInteger(n)&&n>=a&&n<=b;
const stamp=(r,p,now)=>{p.seen=now;r.updated=now;};
const find=(r,id)=>r.members.find(p=>p.id===id&&!p.left);
const modeSettings=d=>gameMode(d.mode)&&accessModes.includes(d.access)&&durations.includes(d.minutes)&&Object.hasOwn(levels,d.difficulty)&&
  (d.voice===undefined||typeof d.voice==='boolean');
const seatText=s=>s.status??'lobby';
const blocked=(db,a,b)=>one(db,'SELECT 1 FROM blocks WHERE owner=? AND target=? OR owner=? AND target=?',a,b,b,a);

async function compatible(db,id,room) {
  const others=room.members.filter(p=>p.id!==id&&!p.left).map(p=>p.id);
  if(!others.length)return true;
  return !await one(db,`SELECT 1 FROM blocks WHERE owner=? AND target IN (SELECT value FROM json_each(?))
    OR target=? AND owner IN (SELECT value FROM json_each(?)) LIMIT 1`,id,JSON.stringify(others),id,JSON.stringify(others));
}

function brief(room,now) {
  const current=room.phase==='lobby'?livingRoom(room,now):room.members.filter(p=>!p.left);
  return {code:room.code,mode:room.mode,access:room.access,phase:room.phase,minutes:room.minutes,difficulty:room.difficulty,voice:Boolean(room.voice),
    seats:current.length,capacity:capacity(room.mode),host:current.find(p=>p.id===room.host)?.name??'Room'};
}
function roomView(room,profile,now,masked) {
  const p=find(room,profile.id);
  return {...brief(room,now),hostId:room.host,me:profile.id,ticket:p?.ticket,game:room.game,winner:room.winner,reason:room.reason,
    ranked:room.ranked??false,queue:Boolean(room.queueTarget),members:room.members.filter(q=>!q.left||room.phase==='result').map(q=>({id:q.id,name:q.name,role:q.role,
      status:seatText(q),preference:q.preference,ready:q.ready,online:!q.left&&now-q.seen<4500,
      escapes:Number(Boolean(q.escapedAt)),rescues:q.rescues,objectives:q.objectives,captures:q.captures})),
    chat:room.chat.filter(line=>!masked.has(line.id)&&(room.phase!=='play'||line.role===p?.role))};
}
async function saveResult(db,room,old) {
  const lineup=room.members.map(p=>p.id).sort().join(',');
  const eligible=room.access==='public'&&room.mode==='pvp'&&!room.forfeit&&room.finished-room.started>=40_000;
  const hunter=room.members.find(p=>p.role==='granny')?.id??'';
  const survivors=JSON.stringify(room.members.filter(p=>p.role==='survivor').map(p=>p.id));
  const update=roomUpdate(db,room,old);
  const stmts=[update,statement(db,`INSERT INTO multiplayer_matches(id,mode,lineup,ranked,finished_at)
    SELECT ?,?,?,CASE WHEN ?=1 AND NOT EXISTS(
      SELECT 1 FROM multiplayer_results a JOIN multiplayer_results b ON a.game=b.game AND a.role<>b.role
      JOIN multiplayer_matches m ON m.id=a.game WHERE a.player=? AND b.player IN (SELECT value FROM json_each(?))
      AND m.ranked=1 AND m.finished_at>?
    ) THEN 1 ELSE 0 END,? WHERE changes()=1 ON CONFLICT(id) DO NOTHING`,room.game,room.mode,lineup,Number(eligible),
    hunter,survivors,Math.floor(room.finished)-6*60*60_000,Math.floor(room.finished))];
  for(const p of room.members) {
    const won=Number(p.role==='granny'?room.winner==='granny':Boolean(p.escapedAt));
    const seconds=Math.floor(Math.max(0,(p.finishedAt||room.finished)-room.started)/1000);
    const score=p.role==='granny'?p.captures*95+won*250:won*300+p.rescues*80+p.objectives*35;
    stmts.push(statement(db,`INSERT OR IGNORE INTO multiplayer_results
      (game,player,role,won,escapes,rescues,objectives,captures,seconds,capture_time,score)
      SELECT id,?,?,?,?,?,?,?,?,?,CASE WHEN ranked=1 THEN ? ELSE 0 END FROM multiplayer_matches
      WHERE id=? AND EXISTS(SELECT 1 FROM profiles WHERE id=? AND closing=0)`,p.id,p.role,won,Number(Boolean(p.escapedAt)),
      p.rescues,p.objectives,p.captures,seconds,Math.floor(p.captureTime/1000),score,room.game,p.id));
  }
  stmts.push(statement(db,'DELETE FROM multiplayer_voice_signals WHERE code=? AND game=?',room.code,room.game));
  const result=await db.batch(stmts);
  if(!result[0].meta.changes)return false;
  room.ranked=Boolean((await one(db,'SELECT ranked FROM multiplayer_matches WHERE id=?',room.game))?.ranked);
  return true;
}
function roomUpdate(db,r,row) {
  return statement(db,`UPDATE multiplayer_rooms SET revision=revision+1,touched=?,phase=?,access=?,mode=?,state=?
    WHERE code=? AND revision=?`,r.updated,r.phase,r.access,r.mode,JSON.stringify(r),r.code,row.revision);
}
async function changeRoom(db,code,operation) {
  for(let retry=0;retry<9;retry++) {
    const row=await one(db,'SELECT revision,touched,state FROM multiplayer_rooms WHERE code=?',code);
    const now=Date.now();
    if(!row||row.touched<now-maxAge)fail(404,'This room is closed.');
    const room=JSON.parse(row.state);
    if(room.version!==MATCH_VERSION) {
      if(room.phase==='play'||![1,2].includes(room.version))fail(409,'This match used the previous mansion layout. Start a new match.');
      room.version=MATCH_VERSION;
    }
    const result=await operation(room,now);
    if(result===false)return room;
    if(room.phase==='result'&&!room.recorded) {
      room.recorded=true;
      if(await saveResult(db,room,row))return room;
    } else if((await roomUpdate(db,room,row).run()).meta.changes)return room;
  }
  fail(503,'Room is busy. Retrying…');
}
function lobbyCleanup(room,now) {
  if(room.phase==='play')return;
  const current=livingRoom(room,now);
  if(room.phase==='lobby')room.members=current;
  if(!current.some(p=>p.id===room.host))room.host=current[0]?.id??null;
}
async function createRoom(db,profile,d,now,quick=false) {
  if(!modeSettings(d))fail(400,'Choose a valid mode, room type, length and difficulty.');
  await write(db,'DELETE FROM multiplayer_rooms WHERE touched<?',now-maxAge);
  for(let i=0;i<6;i++) {
    const code=Array.from(crypto.getRandomValues(new Uint8Array(6)),n=>alphabet[n&31]).join('');
    const p=newMember(profile,now);
    if(quick)p.ready=true;
    const room={code,version:MATCH_VERSION,updated:now,created:now,host:profile.id,
      mode:d.mode,access:d.access,minutes:d.minutes,difficulty:d.difficulty,voice:Boolean(d.voice),quick,phase:'lobby',members:[p],chat:[]};
    const r=await write(db,`INSERT OR IGNORE INTO multiplayer_rooms(code,touched,phase,access,mode,state)
      VALUES(?,?,'lobby',?,?,?)`,code,now,d.access,d.mode,JSON.stringify(room));
    if(r.meta.changes)return room;
  }
  fail(503,'Could not reserve a room code. Try again.');
}
async function joinRoom(db,code,profile,quick=false) {
  return changeRoom(db,code,async(r,now)=>{
    lobbyCleanup(r,now);
    let p=find(r,profile.id);
    if(p) {
      if(r.phase==='play')advanceMatch(r,now);
      stamp(r,p,now);return true;
    }
    if(r.phase!=='lobby'||r.members.length>=capacity(r.mode))fail(409,'This match is in progress or the room is full.');
    if(!await compatible(db,profile.id,r))fail(403,'This room is unavailable.');
    p=newMember(profile,now);p.ready=quick;r.members.push(p);
    r.host??=p.id;stamp(r,p,now);
    maybeStart(r,now);
    return true;
  });
}
function eligible(room,now) {
  const online=room.members.filter(p=>!p.left&&now-p.seen<4500);
  return online.length>=minPlayers&&online.length===room.members.length&&online.every(p=>p.ready);
}
function maybeStart(room,now) {
  if(room.quick&&room.phase==='lobby'&&room.members.length>=(room.queueTarget??minPlayers)&&eligible(room,now))startMatch(room,now);
}
function resetLobby(r,now) {
  const keep=livingRoom(r,now);
  for(const p of keep){p.ready=false;delete p.role;delete p.status;}
  Object.assign(r,{phase:'lobby',members:keep,game:null,world:null,winner:null,reason:null,
    recorded:false,ranked:false,forfeit:false,quick:false,queueTarget:null,events:[],chat:[]});
}
const quant='CASE WHEN m.ranked=1 THEN 1 ELSE 0 END';
const totals=`COUNT(*) AS games,SUM(r.won) AS wins,SUM(r.escapes) AS escapes,SUM(r.rescues) AS rescues,
  SUM(r.objectives) AS objectives,SUM(r.captures) AS captures,ROUND(AVG(r.seconds)) AS survival,
  CASE WHEN SUM(r.captures)>0 THEN ROUND(1.0*SUM(r.capture_time)/SUM(r.captures)) END AS captureTime,
  SUM(${quant}) AS rankedGames,SUM(r.score) AS score`;

export async function multiplayerRecord(db,id) {
  return many(db,`SELECT r.role,${totals} FROM multiplayer_results r JOIN multiplayer_matches m ON m.id=r.game
    WHERE r.player=? GROUP BY r.role`,id);
}
async function rankings(db,role,profile) {
  if(!['survivor','granny'].includes(role))fail(400,'Choose Survivor or Caretaker standings.');
  const id=profile?.id??'';
  return many(db,`SELECT p.username,r.role,${totals} FROM multiplayer_results r
    JOIN multiplayer_matches m ON m.id=r.game AND m.ranked=1 JOIN profiles p ON p.id=r.player
    WHERE r.role=? AND p.closing=0 AND p.visibility='public' AND NOT EXISTS(
      SELECT 1 FROM blocks b WHERE (b.owner=? AND b.target=p.id) OR (b.owner=p.id AND b.target=?))
    GROUP BY p.id ORDER BY score DESC,wins DESC,p.username COLLATE NOCASE LIMIT 50`,role,id,id);
}
async function dashboard(db,profile,now) {
  const [rows,inbox,stats,current]=await Promise.all([
    many(db,`SELECT state FROM multiplayer_rooms WHERE phase='lobby' AND access='public' AND touched>?
      ORDER BY touched DESC LIMIT 25`,now-graceMs),
    many(db,`SELECT i.code,i.sender,p.username,i.sent_at FROM multiplayer_invites i
      JOIN profiles p ON p.id=i.sender AND p.closing=0 JOIN multiplayer_rooms r ON r.code=i.code AND r.phase='lobby'
      WHERE i.recipient=? AND i.sent_at>? AND r.touched>? AND NOT EXISTS(
      SELECT 1 FROM blocks b WHERE (b.owner=i.sender AND b.target=i.recipient) OR (b.owner=i.recipient AND b.target=i.sender))
      ORDER BY i.sent_at DESC LIMIT 20`,profile.id,now-graceMs*9,now-graceMs),
    multiplayerRecord(db,profile.id),
    one(db,`SELECT r.code FROM multiplayer_rooms r
      WHERE r.phase='play' AND r.touched>? AND json_extract(r.state,'$.version')=? AND EXISTS(
        SELECT 1 FROM json_each(r.state,'$.members') AS p
        WHERE json_extract(p.value,'$.id')=? AND COALESCE(json_extract(p.value,'$.left'),0)=0
        AND json_extract(p.value,'$.seen')>?
      ) ORDER BY r.touched DESC LIMIT 1`,now-graceMs,MATCH_VERSION,profile.id,now-graceMs)
  ]);
  const publicRooms=rows.map(r=>brief(JSON.parse(r.state),now)).filter(r=>r.seats>0&&r.seats<r.capacity);
  return {rooms:publicRooms,invites:inbox,stats,resume:current?.code??null};
}
export async function multiplayerPresence(db,friends,now) {
  const accepted=new Set(friends);
  if(!accepted.size)return {};
  const rows=await many(db,`SELECT state FROM multiplayer_rooms WHERE phase IN ('lobby','play') AND touched>?
    ORDER BY touched DESC LIMIT 60`,now-7000);
  const presence={};
  for(const row of rows) {
    const r=JSON.parse(row.state);
    for(const p of r.members) {
      if(!accepted.has(p.id)||p.left||now-p.seen>6500||presence[p.id])continue;
      presence[p.id]={status:r.phase==='play'?'In a match':'In a lobby',
        code:r.phase==='lobby'&&r.access==='public'&&livingRoom(r,now).length<capacity(r.mode)?r.code:null};
    }
  }
  return presence;
}
async function invite(db,room,profile,id,now) {
  if(typeof id!=='string'||!uuidPattern.test(id)||id===profile.id)fail(400,'Choose a friend.');
  const found=await one(db,`SELECT 1 FROM friendships WHERE low=min(?,?) AND high=max(?,?) AND status='accepted'`,profile.id,id,profile.id,id);
  if(!found||await blocked(db,profile.id,id))fail(403,'You can only invite an available friend.');
  await write(db,`INSERT INTO multiplayer_invites(code,sender,recipient,sent_at) VALUES(?,?,?,?)
    ON CONFLICT(code,recipient) DO UPDATE SET sender=excluded.sender,sent_at=excluded.sent_at`,room.code,profile.id,id,now);
}
async function mutate(db,room,p,d,now) {
  if(d.op==='touch')return;
  if(d.op==='leave') {
    p.left=true;
    if(room.phase==='play')advanceMatch(room,now);
    if(room.phase!=='play')lobbyCleanup(room,now);
    return;
  }
  if(d.op==='report') {
    const other=room.members.find(p=>p.id===d.target);
    if(room.phase!=='result'||!other||other.id===p.id||!reasons.includes(d.reason))fail(400,'Choose a player and report reason.');
    await write(db,'INSERT OR IGNORE INTO multiplayer_reports VALUES(?,?,?,?,?)',room.game,p.id,other.id,d.reason,now);
    return;
  }
  if(d.op==='spectate') {
    const other=find(room,d.target);
    if(room.phase==='play'&&p.status!=='active'&&other?.role==='survivor'&&other.status==='active')p.spectate=other.id;
    return;
  }
  if(d.op==='chat') {
    const text=typeof d.text==='string'?d.text.trim().replace(/[\u0000-\u001f\u007f]/g,' '):'';
    if(!text||text.length>220)fail(400,'Write a message of 1 to 220 characters.');
    if(room.phase==='play'&&p.status!=='active')fail(403,'Spectators can chat again after the match.');
    if(room.chat.some(m=>m.id===p.id&&now-m.at<1200))fail(429,'Wait a moment between messages.');
    room.chat.push({key:crypto.randomUUID(),id:p.id,name:p.name,role:p.role??null,text,at:now});
    room.chat=room.chat.slice(-24);return;
  }
  if(d.op==='rematch') {
    if(room.host!==p.id||room.phase!=='result')fail(403,'The host can reopen the room after the match.');
    resetLobby(room,now);return;
  }
  if(room.phase!=='lobby')fail(409,'This match has already started.');
  if(d.op==='invite') {await invite(db,room,{id:p.id},d.target,now);return;}
  if(d.op==='settings') {
    if(room.host!==p.id)fail(403,'Only the host can change settings.');
    if(!modeSettings(d)||room.members.length>capacity(d.mode))fail(400,'That configuration does not fit this room.');
    Object.assign(room,{mode:d.mode,access:d.access,minutes:d.minutes,difficulty:d.difficulty,voice:Boolean(d.voice),quick:false,queueTarget:null});
    for(const member of room.members)member.ready=false;
    return;
  }
  if(d.op==='queue') {
    if(room.host!==p.id)fail(403,'Only the host can queue the party.');
    room.access='public';room.quick=true;room.queueTarget=capacity(room.mode);return;
  }
  if(d.op==='ready') {
    if(!preferences.includes(d.preference)||typeof d.ready!=='boolean')fail(400,'Choose a role and ready status.');
    p.preference=d.preference;p.ready=d.ready;maybeStart(room,now);return;
  }
  if(d.op==='start') {
    if(room.host!==p.id)fail(403,'Only the host can start a match.');
    if(!eligible(room,now))fail(409,'At least two connected players must be ready.');
    if(!await compatible(db,p.id,room))fail(403,'This room is unavailable.');
    startMatch(room,now);return;
  }
  fail(400,'Unknown room action.');
}

function signal(value) {
  if(!value||typeof value!=='object')return null;
  if(['offer','answer'].includes(value.type)&&typeof value.sdp==='string'&&value.sdp.length<9500&&
    value.sdp.split(/\r?\n/).filter(line=>line.startsWith('m=')).every(line=>line.startsWith('m=audio ')))
    return {type:value.type,sdp:value.sdp};
  if(value.type==='ice'&&typeof value.candidate==='string'&&value.candidate.length<1200&&
    (value.sdpMid===null||typeof value.sdpMid==='string'&&value.sdpMid.length<40)&&
    (value.sdpMLineIndex===null||valid(value.sdpMLineIndex,0,8))) {
    return {type:value.type,candidate:value.candidate,sdpMid:value.sdpMid,sdpMLineIndex:value.sdpMLineIndex};
  }
  return null;
}
async function voiceRoute(request,db,code,profile) {
  const d=await body(request,23000),now=Date.now(),id=profile.id;
  if(typeof d.game!=='string'||!uuidPattern.test(d.game)||!valid(d.after,0,Number.MAX_SAFE_INTEGER)||
    (d.enabled!==undefined&&typeof d.enabled!=='boolean')||!Array.isArray(d.signals)||d.signals.length>18)fail(400,'Invalid voice request.');
  await limit(db,'mp:voice:'+id,110);
  const authorized=r=>{
    const p=find(r,id);
    if(r.game!==d.game||r.phase!=='play'||!r.voice||!p||(d.enabled!==false&&p.status!=='active'))fail(403,'Proximity voice is unavailable.');
    return p;
  };
  const room=await changeRoom(db,code,r=>{
    const p=authorized(r);
    if(d.enabled===undefined)return false;
    p.voice=d.enabled?crypto.randomUUID():null;return true;
  });
  const p=authorized(room);
  if(!p.voice) {
    if(d.enabled===false)await write(db,'DELETE FROM multiplayer_voice_signals WHERE code=? AND game=? AND (sender=? OR recipient=?)',code,d.game,id,id);
    return json({signals:[]});
  }
  const disallowed=new Set((await many(db,`SELECT CASE WHEN owner=? THEN target ELSE owner END AS id
    FROM blocks WHERE owner=? OR target=?`,id,id,id)).map(row=>row.id));
  const outgoing=[];
  for(const entry of d.signals) {
    const to=find(room,entry?.to),value=signal(entry?.value);
    if(!value)fail(400,'Invalid voice signal.');
    if(!to||to===p||!to.voice||to.voice!==entry.version||to.status!=='active'||disallowed.has(to.id))continue;
    outgoing.push(statement(db,`INSERT INTO multiplayer_voice_signals(code,game,sender,recipient,payload,expires) VALUES(?,?,?,?,?,?)`,
      code,d.game,id,to.id,JSON.stringify({value,senderVersion:p.voice,recipientVersion:to.voice}),now+20_000));
  }
  if(outgoing.length||d.enabled!==undefined)await db.batch([
    statement(db,'DELETE FROM multiplayer_voice_signals WHERE expires<?',now),...outgoing
  ]);
  const rows=await many(db,`SELECT id,sender,payload FROM multiplayer_voice_signals
    WHERE code=? AND game=? AND recipient=? AND id>? AND expires>? ORDER BY id LIMIT 70`,code,d.game,id,d.after,now);
  const signals=rows.filter(row=>!disallowed.has(row.sender)).flatMap(row=>{
    const sender=find(room,row.sender),data=JSON.parse(row.payload);
    return sender?.voice===data.senderVersion&&data.recipientVersion===p.voice?[{id:row.id,from:row.sender,version:sender.voice,value:data.value}]:[];
  });
  return json({signals,after:rows.at(-1)?.id??d.after,version:p.voice,blocked:[...disallowed]});
}

export async function exchange(request,env,code) {
  const d=await body(request,640);
  if(d.version!==MATCH_VERSION)fail(409,'Reload the game to connect.');
  if(typeof d.ticket!=='string'||!uuidPattern.test(d.ticket)||typeof d.game!=='string'||!uuidPattern.test(d.game)||
    !valid(d.seq,0,100_000)||!valid(d.keys,0,31)||!valid(d.yaw,-3142,3142)||!valid(d.pitch,-1430,1430)||
    !valid(d.actions,0,239)||(d.actions&16)||!valid(d.slot,-1,3)||!valid(d.after,0,100_000)||
    (d.worldVersion!==undefined&&!valid(d.worldVersion,0,100_000)))fail(400,'Invalid match input.');
  const db=env.DB;
  const room=await changeRoom(db,code,(r,now)=>{
    const p=r.members.find(q=>q.ticket===d.ticket&&!q.left);
    if(!p||r.game!==d.game||r.phase==='lobby')fail(403,'This match seat is unavailable.');
    if(r.phase==='result')return false;
    if(now-p.seen<72)fail(429,'Slow down.');
    const stale=now-p.seen>=graceMs;
    advanceMatch(r,now);
    if(r.phase==='play'&&!stale){stamp(r,p,now);acceptInput(p,d);}
    return true;
  });
  const p=room.members.find(q=>q.ticket===d.ticket&&!q.left);
  const packet=viewMatch(room,p,d.after,d.worldVersion);
  if(room.phase==='result')packet.ranked=Boolean((await one(db,'SELECT ranked FROM multiplayer_matches WHERE id=?',room.game))?.ranked);
  return json(packet);
}

export async function multiplayer(request,env,url,profile) {
  const db=env.DB,now=Date.now(),path=url.pathname.slice('/api/multiplayer'.length);
  if(path==='/rankings'&&request.method==='GET') {
    await limit(db,'mp:boards:'+(profile?.id??request.headers.get('cf-connecting-ip')??'local'),65);
    return json({rows:await rankings(db,url.searchParams.get('role'),profile)});
  }
  if(!profile)fail(401,'Log in with a gamer tag to play online.');
  const voice=/^\/([A-HJ-NP-Z2-9]{6})\/voice$/.exec(path);
  if(voice&&request.method==='POST')return voiceRoute(request,db,voice[1],profile);
  if(request.method==='GET'&&!path) {
    await limit(db,'mp:directory:'+profile.id,45);
    return json(await dashboard(db,profile,now));
  }
  if(request.method!=='POST')fail(405,'Use POST.');
  const d=await body(request,1000);
  let room;
  if(!path) {
    await limit(db,'mp:join:'+profile.id,20);
    if(d.op==='create')room=await createRoom(db,profile,d,now);
    else if(d.op==='join') {
      if(typeof d.code!=='string'||!codePattern.test(d.code))fail(400,'Enter a six-character room code.');
      room=await joinRoom(db,d.code,profile);
    } else if(d.op==='quick') {
      if(!gameMode(d.mode))fail(400,'Choose a mode.');
      const rooms=await many(db,`SELECT code,state FROM multiplayer_rooms WHERE phase='lobby' AND access='public' AND mode=?
        AND touched>? ORDER BY touched DESC LIMIT 18`,d.mode,now-graceMs);
      for(const row of rooms) {
        const r=JSON.parse(row.state);
        if(!r.quick||r.members.length>=capacity(r.mode)||!await compatible(db,profile.id,r))continue;
        try {room=await joinRoom(db,row.code,profile,true);break;}
        catch(error){if(![403,404,409].includes(error.status))throw error;}
      }
      room??=await createRoom(db,profile,{mode:d.mode,access:'public',minutes:8,difficulty:'normal'},now,true);
    } else fail(400,'Unknown room action.');
  } else {
    const code=path.slice(1);
    if(!codePattern.test(code))fail(404,'Room not found.');
    if(d.op!=='touch')await limit(db,'mp:action:'+profile.id,45);
    room=await changeRoom(db,code,async(r,t)=>{
      lobbyCleanup(r,t);
      const p=find(r,profile.id);
      if(!p)fail(403,'You do not have a seat in this room.');
      if(r.phase==='play'&&d.op==='touch')return false;
      if(t-p.seen<550&&d.op==='touch')return false;
      stamp(r,p,t);
      await mutate(db,r,p,d,t);
      return true;
    });
    if(d.op==='leave')return json({ok:true});
  }
  const mask=await many(db,`SELECT CASE WHEN owner=? THEN target ELSE owner END AS id FROM blocks WHERE owner=? OR target=?`,
    profile.id,profile.id,profile.id);
  if(room.phase==='result')room.ranked=Boolean((await one(db,'SELECT ranked FROM multiplayer_matches WHERE id=?',room.game))?.ranked);
  return json(roomView(room,profile,now,new Set(mask.map(p=>p.id))));
}
