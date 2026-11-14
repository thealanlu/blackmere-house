import {readLocal,writeLocal} from './local-progress.js';
import {MAX_TICKS,RUN_VERSION} from './rules.js';
import {api} from './online.js';

export function soloReplay(seed,difficulty,saved) {
  if(saved&&saved.version!==RUN_VERSION)return null;
  const replay=saved??{id:crypto.randomUUID(),version:RUN_VERSION,seed,difficulty,ticks:0,rows:[]};
  return {
    record(input) {
      if(++replay.ticks>MAX_TICKS+5)return;
      const last=replay.rows.at(-1);
      if(last&&input[3]===0&&input[4]===-1&&input.every((v,i)=>v===last[i+1]))last[0]++;
      else replay.rows.push([1,...input]);
    },
    snapshot(){return replay.ticks<=MAX_TICKS+5?replay:null;}
  };
}
const key=id=>'record:'+(id??'guest');
let queue=Promise.resolve();
export async function readRecord(owner) {
  const value=await readLocal(key(owner));
  return value??{runs:0,escapes:0,front:false,drain:false,nightmare:false,pending:[]};
}
export function recordResult(owner,result,replay) {
  queue=queue.catch(()=>{}).then(async()=>{
    const record=await readRecord(owner);
    record.runs++;record.escapes+=Number(Boolean(result.route));
    if(result.route) {
      record[result.route]=true;
      if(result.difficulty==='nightmare')record.nightmare=true;
      if(replay)record.pending=[...record.pending,replay];
    }
    return writeLocal(key(owner),record);
  });
  return queue;
}
export async function syncRecords(owner,sources) {
  const records=await Promise.all(sources.map(readRecord));
  for(const row of records)for(const run of row.pending) {
    try{await api('offline-record',{method:'POST',data:{...run,owner}});}
    catch(error){if(![400,422].includes(error.status))throw error;}
    queue=queue.catch(()=>{}).then(async()=>{
      for(const source of sources) {
        const value=await readRecord(source);
        value.pending=value.pending.filter(item=>item.id!==run.id);
        await writeLocal(key(source),value);
      }
    });
    await queue;
  }
  return api('offline-record');
}
