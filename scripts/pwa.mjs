import {createHash} from 'node:crypto';
import {readdir,readFile,writeFile} from 'node:fs/promises';

const sha=data=>createHash('sha256').update(data).digest('hex');
const workerSource=new URL('./offline-worker.js',import.meta.url);

export async function buildPwa(output) {
  const files=['index.html','style.css','multiplayer.css','adaptive.css','blackmere.webmanifest','third-party-notices.txt'];
  async function collect(folder) {
    for(const entry of await readdir(new URL(folder+'/',output),{withFileTypes:true})) {
      const path=folder+'/'+entry.name;
      if(entry.isDirectory())await collect(path);
      else if(entry.isFile())files.push(path);
    }
  }
  for(const folder of ['src','vendor','assets'])await collect(folder);
  const entries=await Promise.all(files.sort().map(async path=>{
    const bytes=await readFile(new URL(path,output));
    return {path,size:bytes.length,sha256:sha(bytes)};
  }));
  const source=await readFile(workerSource,'utf8');
  const version=sha(source+JSON.stringify(entries)).slice(0,20);
  const manifest={version,total:entries.reduce((sum,file)=>sum+file.size,0),files:entries};
  await writeFile(new URL('offline-manifest.json',output),JSON.stringify(manifest)+'\n');
  await writeFile(new URL('sw.js',output),'const manifest='+JSON.stringify(manifest)+';\n'+source);
}
