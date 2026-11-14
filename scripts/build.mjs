import {mkdir,readdir,readFile,writeFile} from 'node:fs/promises';
import {join,extname} from 'node:path';
import {build} from 'esbuild';
import './level.mjs';
import {buildPwa} from './pwa.mjs';

const {validateMansion}=await import('./validate-level.mjs');
validateMansion();
await buildPwa(new URL('../dist/',import.meta.url));

const types={'.json':'application/json; charset=utf-8','.html':'text/html; charset=utf-8','.css':'text/css; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.txt':'text/plain; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.webp':'image/webp','.webmanifest':'application/manifest+json'};
const assets=Object.create(null);
async function walk(directory,prefix='') {
  for(const entry of await readdir(directory,{withFileTypes:true})) {
    if(entry.name.startsWith('.')||entry.name==='server')continue;
    const file=join(directory,entry.name),url=prefix+'/'+entry.name;
    if(entry.isDirectory()){await walk(file,url);continue;}
    const type=types[extname(file)];
    if(!type)throw new Error('Unexpected public file '+file);
    const data=await readFile(file),binary=type.startsWith('image/');
    assets[url]=[type,data.toString(binary?'base64':'utf8'),binary];
  }
}
await walk('dist');
await writeFile('server/assets.generated.js','export default Object.assign(Object.create(null),'+JSON.stringify(assets)+');\n');
await mkdir('dist/server',{recursive:true});
await mkdir('dist/.openai',{recursive:true});
await build({entryPoints:['server/worker.js'],outfile:'dist/server/index.js',bundle:true,format:'esm',
  platform:'browser',target:'es2022',minify:true,legalComments:'inline'});
await writeFile('dist/.openai/hosting.json',await readFile('.openai/hosting.json'));
