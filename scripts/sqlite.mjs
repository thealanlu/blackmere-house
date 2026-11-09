import {DatabaseSync} from 'node:sqlite';
import {readdirSync,readFileSync} from 'node:fs';

const directory=new URL('../drizzle/',import.meta.url);
export function sqlite(path=':memory:') {
  const db=new DatabaseSync(path);
  db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=4000; CREATE TABLE IF NOT EXISTS _local_migrations(name TEXT PRIMARY KEY)');
  const applied=db.prepare('SELECT 1 FROM _local_migrations WHERE name=?');
  for(const file of readdirSync(directory).filter(s=>s.endsWith('.sql')).sort()) {
    if(applied.get(file))continue;
    db.exec('BEGIN');
    try {
      db.exec(readFileSync(new URL(file,directory),'utf8'));
      db.prepare('INSERT INTO _local_migrations VALUES (?)').run(file);db.exec('COMMIT');
    }catch(e){db.exec('ROLLBACK');throw e;}
  }
  function prepare(sql,args=[]) {
    const s=db.prepare(sql);
    return {bind:(...values)=>prepare(sql,values),
      first:async()=>s.get(...args)??null,all:async()=>({results:s.all(...args)}),
      run:()=>({meta:{changes:Number(s.run(...args).changes)}})
    };
  }
  return {prepare,
    async batch(statements) {
      db.exec('BEGIN IMMEDIATE');
      try{const r=statements.map(s=>s.run());db.exec('COMMIT');return r;}
      catch(e){db.exec('ROLLBACK');throw e;}
    },
    close(){db.close();}
  };
}
