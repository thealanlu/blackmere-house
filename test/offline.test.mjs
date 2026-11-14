import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import worker from '../dist/server/index.js';
import {sqlite} from '../scripts/sqlite.mjs';
import {RUN_VERSION} from '../dist/src/rules.js';
import {soloReplay} from '../dist/src/solo-record.js';
import {play} from './driver.mjs';

test('the offline manifest hashes every packaged game asset and excludes the server',async()=>{
  const dist=new URL('../dist/',import.meta.url);
  const {files,total}=JSON.parse(await readFile(new URL('offline-manifest.json',dist)));
  assert.equal(total,files.reduce((sum,file)=>sum+file.size,0));
  for(const file of files) {
    const bytes=await readFile(new URL(file.source,dist));
    assert.equal(bytes.length,file.size);
    assert.equal(createHash('sha256').update(bytes).digest('hex'),file.sha256);
    assert.doesNotMatch(file.path,/^(api|server|\.openai)\//);
  }
  for(const path of ['index.html','src/game.js','src/audio.js','src/level-data.js','vendor/three.module.js','assets/caretaker-albedo.webp'])
    assert.ok(files.some(file=>file.path===path),path);
});

test('offline escapes are replay verified and idempotent in a separate account record',async()=>{
  const DB=sqlite(),origin='https://blackmere.test';
  const request=async(path,data,subject='one')=>{
    const response=await worker.fetch(new Request(origin+'/api/'+path,{method:data?'POST':'GET',
      headers:{origin,'Content-Type':'application/json','oai-authenticated-user-id':subject},
      body:data?JSON.stringify(data):undefined}),{DB,PLATFORM_AUTH:'1'});
    return {status:response.status,...await response.json()};
  };
  try {
    await request('profile',{username:'OfflinePlayer'});
    await request('profile',{username:'OtherPlayer'},'two');
    const start=await request('runs',{difficulty:'nightmare',version:RUN_VERSION});
    assert.equal(start.status,201);
    assert.equal(start.difficulty,'nightmare');
    const {log}=play(100,'story','front');
    let replay=soloReplay(100,'story');
    for(const input of log.slice(0,500))replay.record(input);
    replay=soloReplay(100,'story',structuredClone(replay.snapshot()));
    for(const input of log.slice(500))replay.record(input);
    const run=replay.snapshot();
    assert.equal((await request('offline-record',{...run,id:crypto.randomUUID(),rows:[[1,0,0,0,0,-1]]})).status,422);
    assert.equal((await request('offline-record',run)).status,200);
    assert.equal((await request('offline-record',run)).status,200);
    assert.equal((await request('offline-record',{...run,id:crypto.randomUUID()})).status,200);
    assert.equal((await request('offline-record')).escapes,1);
    assert.equal((await request('offline-record')).front,1);
    assert.equal((await request('offline-record',null,'two')).escapes,0);
    assert.equal((await DB.prepare('SELECT COUNT(*) AS count FROM results').first()).count,0);
  }finally{DB.close();}
});
