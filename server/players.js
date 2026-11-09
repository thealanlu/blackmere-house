import {body,fail,json,one,many,write,statement,limit} from './http.js';
import {username,removeIdentity,cleared} from './auth.js';

export const profileFor=(db,user)=>user?one(db,'SELECT * FROM profiles WHERE subject=? AND closing=0',user.subject):null;
const view=(p)=>p?{id:p.id,username:p.username,createdAt:p.created_at,visibility:p.visibility,allowRequests:Boolean(p.requests),avatar:Boolean(p.avatar)}:null;
const fields='p.id,p.username,p.created_at,p.visibility,p.requests,p.avatar IS NOT NULL AS avatar';
const pair=(a,b)=>a<b?[a,b]:[b,a];
const blockedSQL='(b.owner=? AND b.target=p.id OR b.owner=p.id AND b.target=?)';
const rankOrder={
  score:'score DESC, escapes DESC, COALESCE(best,999999) ASC',
  fastest:'best ASC, score DESC',
  escapes:'escapes DESC, score DESC',
  rate:'(CAST(escapes AS REAL)/games) DESC, games DESC, score DESC'
};
const totals=`COUNT(r.run) AS games,COUNT(r.route) AS escapes,COALESCE(SUM(r.deaths),0) AS deaths,
  MIN(CASE WHEN r.route IS NOT NULL THEN r.ticks END) AS best,COALESCE(SUM(r.score),0) AS score`;

async function stats(db,id) {
  return one(db,`SELECT ${totals} FROM results r WHERE r.player=?`,id);
}
export async function board(db,url,profile) {
  const metric=url.searchParams.get('metric')??'score';
  if(!Object.hasOwn(rankOrder,metric))fail(400,'Unknown ranking metric.');
  const period=url.searchParams.get('period')??'all';
  if(!['week','month','all'].includes(period))fail(400,'Unknown ranking period.');
  const scope=url.searchParams.get('scope')??'global';
  if(!['global','friends'].includes(scope))fail(400,'Unknown ranking scope.');
  const friends=scope==='friends';
  if(friends&&!profile)fail(401,'Sign in to view the friends leaderboard.');
  const now=new Date(),utc=Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),now.getUTCDate());
  const since=period==='week'?utc-((now.getUTCDay()+6)%7)*86400000:period==='month'?Date.UTC(now.getUTCFullYear(),now.getUTCMonth(),1):0;
  const search=(url.searchParams.get('q')??'').slice(0,24).trim().toLowerCase();
  const page=Math.max(1,Math.min(10000,Number.parseInt(url.searchParams.get('page'),10)||1));
  const id=profile?.id??'';
  const filter=friends?`(p.id=? OR p.visibility IN ('public','friends') AND EXISTS (
      SELECT 1 FROM friendships f WHERE f.status='accepted' AND f.low=min(?,p.id) AND f.high=max(?,p.id)))`
    :`p.visibility='public'`;
  const where={score:'score>0',fastest:'best IS NOT NULL',escapes:'escapes>0',rate:'games>=5'}[metric];
  const cte=`WITH aggregate AS (
    SELECT ${fields},${totals} FROM profiles p JOIN results r ON r.player=p.id AND r.finished_at>=?
    WHERE p.closing=0 AND ${filter}
    GROUP BY p.id
  ), ranked AS (
    SELECT *,ROW_NUMBER() OVER(ORDER BY ${rankOrder[metric]},username COLLATE NOCASE,id) AS rank
    FROM aggregate WHERE ${where}
  )`;
  const args=[since,...(friends?[id,id,id]:[])];
  const canList='instr(lower(username),?)>0 AND NOT EXISTS(SELECT 1 FROM blocks b WHERE '+blockedSQL.replaceAll('p.id','ranked.id')+')';
  const count=await one(db,cte+' SELECT COUNT(*) AS count FROM ranked WHERE '+canList,...args,search,id,id);
  const pages=Math.max(1,Math.ceil(count.count/15)),current=Math.min(page,pages);
  const results=await many(db,cte+' SELECT * FROM ranked WHERE '+canList+' ORDER BY rank LIMIT 15 OFFSET ?',...args,search,id,id,(current-1)*15);
  const personal=profile?await one(db,cte+' SELECT * FROM ranked WHERE id=?',...args,id):null;
  return {results,personal,page:current,pages,minimum:5,period,metric,scope};
}

async function canSee(db,target,id) {
  if(!target||target.closing)return false;
  if(target.id===id)return true;
  if(id&&await one(db,'SELECT 1 FROM blocks WHERE owner=? AND target=? OR owner=? AND target=?',id,target.id,target.id,id))return false;
  if(target.visibility==='public')return true;
  if(!id||target.visibility==='private')return false;
  return Boolean(await one(db,"SELECT 1 FROM friendships WHERE low=? AND high=? AND status='accepted'",...pair(id,target.id)));
}
function avatarValue(value) {
  if(value===null)return null;
  if(typeof value!=='string'||value.length>36000||!/^data:image\/(?:webp|png);base64,[A-Za-z0-9+/]+={0,2}$/.test(value))fail(400,'Choose a small PNG or WebP avatar.');
  let raw;
  try{raw=atob(value.split(',')[1]);}catch{fail(400,'Invalid avatar.');}
  if(value.startsWith('data:image/png')) {
    if(raw.length<33||!raw.startsWith('\x89PNG\r\n\x1a\n')||raw.slice(12,16)!=='IHDR')fail(400,'Invalid PNG avatar.');
    const n=i=>raw.charCodeAt(i)*2**24+raw.charCodeAt(i+1)*65536+raw.charCodeAt(i+2)*256+raw.charCodeAt(i+3);
    if(n(16)<1||n(20)<1||n(16)>192||n(20)>192)fail(400,'Avatar dimensions exceed 192 pixels.');
  } else {
    if(raw.length<30||raw.slice(0,4)!=='RIFF'||raw.slice(8,12)!=='WEBP')fail(400,'Invalid WebP avatar.');
    const read16=i=>raw.charCodeAt(i)+raw.charCodeAt(i+1)*256;
    const read24=i=>read16(i)+raw.charCodeAt(i+2)*65536;
    const kind=raw.slice(12,16);
    let w,h;
    if(kind==='VP8X'){w=1+read24(24);h=1+read24(27);}
    if(kind==='VP8 '){w=read16(26)&16383;h=read16(28)&16383;}
    if(kind==='VP8L'){w=1+(read16(21)&16383);h=1+((read24(22)>>6)&16383);}
    if(!w||!h||w>192||h>192)fail(400,'Avatar dimensions exceed 192 pixels.');
  }
  return value;
}
export async function players(request,env,url,user,profile) {
  const db=env.DB,id=profile?.id??'', path=url.pathname.slice(5), method=request.method;
  if(path==='me'&&method==='GET') {
    if(!profile)return json({profile:null,user:user?{provider:user.provider,username:user.username,recovery:user.recovery}:null});
    const [summary,rank,notifications,recent]=await Promise.all([
      stats(db,id),board(db,new URL('https://example.invalid/?metric=score'),profile),
      one(db,'SELECT COUNT(*) AS count FROM notifications WHERE owner=? AND seen=0',id),
      many(db,'SELECT route,ticks,score,finished_at FROM results WHERE player=? ORDER BY finished_at DESC LIMIT 8',id)
    ]);
    return json({profile:view(profile),user:{provider:user.provider,recovery:user.recovery},stats:summary,rank:rank.personal?.rank??null,notifications:notifications.count,recent});
  }
  if(path==='leaderboard'&&method==='GET')return json(await board(db,url,profile));
  const match=/^(profile|avatar)\/([0-9a-f-]{36})$/.exec(path);
  if(match&&method==='GET') {
    const p=await one(db,'SELECT * FROM profiles WHERE id=?',match[2]);
    if(!await canSee(db,p,id))fail(404,'Profile unavailable.');
    if(match[1]==='avatar') {
      if(!p.avatar)fail(404,'Avatar unavailable.');
      const [meta,encoded]=p.avatar.split(',');
      const mime=meta==='data:image/png;base64'?'image/png':'image/webp';
      return new Response(Uint8Array.from(atob(encoded),c=>c.charCodeAt(0)),{headers:{'Content-Type':mime,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'}});
    }
    const rank=await board(db,new URL('https://example.invalid/?metric=score'),p);
    return json({profile:view(p),stats:await stats(db,p.id),rank:rank.personal?.rank??null});
  }
  if(!user)fail(401,'Sign in to continue.');
  if(user.recovery)fail(403,'Finish resetting your password first.');
  if(path==='profile'&&method==='POST') {
    await limit(db,'profile:'+user.subject,12);
    if(profile)fail(409,'Your profile already exists.');
    const d=await body(request,1600),name=username(d.username);
    const reserved=await one(db,'SELECT 1 FROM profiles WHERE username=? OR subject=?',name,user.subject);
    if(reserved)fail(409,'That username is unavailable.');
    const result=await write(db,`INSERT OR IGNORE INTO profiles(id,subject,username,created_at) VALUES (?,?,?,?)`,crypto.randomUUID(),user.subject,name,Date.now());
    if(result.meta.changes!==1)fail(409,'That username is unavailable.');
    return json({profile:view(await profileFor(db,user))},201);
  }
  if(!profile)fail(403,'Create a player profile first.');
  if(path==='profile'&&method==='PATCH') {
    await limit(db,'profile:'+user.subject,12);
    const d=await body(request),name=username(d.username);
    if(!['public','friends','private'].includes(d.visibility)||typeof d.allowRequests!=='boolean')fail(400,'Invalid privacy settings.');
    const avatar=d.avatar===undefined?profile.avatar:avatarValue(d.avatar);
    const result=await write(db,`UPDATE OR IGNORE profiles SET username=?,visibility=?,requests=?,avatar=? WHERE id=? AND closing=0`,name,d.visibility,Number(d.allowRequests),avatar,id);
    if(result.meta.changes!==1)fail(409,'That username is already taken.');
    return json({profile:view(await profileFor(db,user))});
  }
  if(path==='profile'&&method==='DELETE') {
    await limit(db,'delete:'+user.subject,4);
    const d=await body(request,800);
    if(d.confirm!==profile.username)fail(400,'Type your current username to confirm.');
    await write(db,'UPDATE profiles SET closing=1 WHERE id=?',id);
    try{await removeIdentity(env,user);}
    catch(error){await write(db,'UPDATE profiles SET closing=0 WHERE id=?',id);throw error;}
    await write(db,'DELETE FROM profiles WHERE id=?',id);
    return cleared(request,{deleted:true});
  }
  if(path==='players'&&method==='GET') {
    await limit(db,'search:'+id,40);
    const search=(url.searchParams.get('q')??'').trim();
    if(!/^[a-z0-9_]{2,24}$/i.test(search))return json({players:[]});
    const rows=await many(db,`SELECT ${fields},f.status AS relationship,f.sender FROM profiles p
      LEFT JOIN friendships f ON f.low=min(?,p.id) AND f.high=max(?,p.id)
      WHERE p.id<>? AND p.closing=0 AND p.visibility='public' AND substr(lower(p.username),1,length(?))=lower(?)
      AND NOT EXISTS (SELECT 1 FROM blocks b WHERE ${blockedSQL}) ORDER BY p.username LIMIT 20`,id,id,id,search,search,id,id);
    return json({players:rows.map(p=>({...view(p),relationship:p.relationship,outgoing:p.sender===id}))});
  }
  if(path==='friends'&&method==='GET') {
    const [rows,blocks,notes]=await Promise.all([
      many(db,`SELECT ${fields},f.status,f.sender FROM friendships f JOIN profiles p
        ON p.id=CASE WHEN f.low=? THEN f.high ELSE f.low END
        WHERE (f.low=? OR f.high=?) AND p.closing=0 ORDER BY f.changed_at DESC LIMIT 500`,id,id,id),
      many(db,`SELECT p.id,p.username FROM blocks b JOIN profiles p ON p.id=b.target WHERE b.owner=? AND p.closing=0 ORDER BY p.username`,id),
      many(db,`SELECT n.id,n.kind,n.seen,n.created_at,p.username FROM notifications n JOIN profiles p ON p.id=n.sender
        WHERE n.owner=? AND p.closing=0 ORDER BY n.created_at DESC LIMIT 30`,id)
    ]);
    return json({friends:rows.map(p=>({...view(p),relationship:p.status,outgoing:p.sender===id})),blocks,notifications:notes});
  }
  if(path==='notifications'&&method==='POST') {
    await limit(db,'notes:'+id,20);
    await write(db,'UPDATE notifications SET seen=1 WHERE owner=? AND seen=0',id);
    return json({ok:true});
  }
  if(path==='friends'&&method==='POST') {
    await limit(db,'social:'+id,25);
    const {target,action}=await body(request,1200);
    if(typeof target!=='string'||!/^[0-9a-f-]{36}$/.test(target)||id===target)fail(400,'Choose another player.');
    const [low,high]=pair(id,target),now=Date.now();
    const p=await one(db,'SELECT * FROM profiles WHERE id=? AND closing=0',target);
    if(!p)fail(404,'Player unavailable.');
    if(action==='block') {
      await db.batch([
        statement(db,'INSERT OR IGNORE INTO blocks(owner,target) VALUES(?,?)',id,target),
        statement(db,'DELETE FROM friendships WHERE low=? AND high=?',low,high),
        statement(db,'DELETE FROM notifications WHERE owner=? AND sender=? OR owner=? AND sender=?',id,target,target,id)
      ]);
      return json({ok:true});
    }
    if(action==='unblock') {
      await write(db,'DELETE FROM blocks WHERE owner=? AND target=?',id,target);return json({ok:true});
    }
    if(action==='send') {
      const count=await one(db,'SELECT COUNT(*) AS count FROM friendships WHERE low=? OR high=?',id,id);
      if(count.count>=500)fail(400,'Friend list or request limit reached.');
      const result=await db.batch([
        statement(db,`INSERT OR IGNORE INTO friendships(low,high,sender,status,changed_at)
          SELECT ?,?,?,'pending',? FROM profiles WHERE id=? AND closing=0 AND requests=1 AND visibility='public'
          AND NOT EXISTS(SELECT 1 FROM blocks WHERE owner=? AND target=? OR owner=? AND target=?)
          AND (SELECT count(*) FROM friendships WHERE low=? OR high=?)<500`,low,high,id,now,target,id,target,target,id,target,target),
        statement(db,`INSERT INTO notifications(id,owner,sender,kind,created_at)
          SELECT ?,?,?,'request',? WHERE changes()=1`,crypto.randomUUID(),target,id,now)
      ]);
      if(result[0].meta.changes!==1)fail(409,'Friend request is unavailable or already exists.');
      return json({ok:true});
    }
    if(action==='accept') {
      const result=await db.batch([
        statement(db,`UPDATE friendships SET status='accepted',changed_at=?
          WHERE low=? AND high=? AND sender=? AND status='pending'`,now,low,high,target),
        statement(db,`INSERT INTO notifications(id,owner,sender,kind,created_at)
          SELECT ?,?,?,'accepted',? WHERE changes()=1`,crypto.randomUUID(),target,id,now),
        statement(db,"UPDATE notifications SET seen=1 WHERE owner=? AND sender=? AND kind='request'",id,target)
      ]);
      if(result[0].meta.changes!==1)fail(409,'This request is no longer pending.');
      return json({ok:true});
    }
    const filters={cancel:"status='pending' AND sender=?",decline:"status='pending' AND sender=?",remove:"status='accepted' AND ? IS NOT NULL"};
    if(!Object.hasOwn(filters,action))fail(400,'Unknown friend action.');
    const result=await db.batch([
      statement(db,'DELETE FROM friendships WHERE low=? AND high=? AND '+filters[action],low,high,action==='decline'?target:id),
      statement(db,`DELETE FROM notifications WHERE kind='request' AND
        (owner=? AND sender=? OR owner=? AND sender=?) AND changes()=1`,id,target,target,id)
    ]);
    if(result[0].meta.changes!==1)fail(409,'That relationship has changed.');
    return json({ok:true});
  }
  fail(404,'Unknown player endpoint.');
}
