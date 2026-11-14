import {body,fail,json,limit,one,write} from './http.js';
import {preferencePatch} from '../dist/src/preferences.js';
import {validCheckpoint} from '../dist/src/checkpoint.js';

export async function deviceSync(request,env,path,profile) {
  if(!profile)fail(401,'Sign in to sync across devices.');
  const db=env.DB,id=profile.id;
  if(!['GET','POST'].includes(request.method))fail(405,'Use GET or POST.');
  if(path==='preferences') {
    if(request.method==='GET') {
      const row=await one(db,'SELECT preferences FROM player_devices WHERE player=?',id);
      return json({preferences:row?JSON.parse(row.preferences):{}});
    }
    await limit(db,'preferences:'+id,50);
    const patch=preferencePatch(await body(request,2000));
    if(!patch||!Object.keys(patch).length)fail(400,'Choose valid preferences to sync.');
    await write(db,`INSERT INTO player_devices(player,preferences) VALUES (?,?)
      ON CONFLICT(player) DO UPDATE SET preferences=json_patch(player_devices.preferences,excluded.preferences)`,id,JSON.stringify(patch));
    return json({ok:true});
  }
  const state=async()=>await one(db,'SELECT checkpoint,revision,updated_at FROM player_devices WHERE player=?',id);
  if(request.method==='GET') {
    const row=await state();
    return json({checkpoint:row?.checkpoint?JSON.parse(row.checkpoint):null,revision:row?.revision??0,updated:row?.updated_at??0});
  }
  await limit(db,'checkpoint:'+id,18);
  const d=await body(request,36_000);
  if(d.owner!==undefined&&d.owner!==id)fail(409,'The signed-in account changed. Review your saves again.');
  if(!Number.isSafeInteger(d.revision)||d.revision<0||!(d.checkpoint===null||validCheckpoint(d.checkpoint)))fail(400,'This solo save is unavailable.');
  await write(db,'INSERT OR IGNORE INTO player_devices(player) VALUES (?)',id);
  const now=Date.now();
  const result=await write(db,`UPDATE player_devices SET checkpoint=?,revision=revision+1,updated_at=? WHERE player=? AND revision=?`,
    d.checkpoint===null?null:JSON.stringify(d.checkpoint),now,id,d.revision);
  if(!result.meta.changes)fail(409,'A newer cloud save is available. Open Single Player to load it.');
  return json({revision:d.revision+1,updated:now});
}
