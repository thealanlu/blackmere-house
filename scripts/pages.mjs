import {cp,mkdir,readFile,rm,writeFile} from 'node:fs/promises';

const source=new URL('../dist/',import.meta.url);
const output=new URL('../.pages/',import.meta.url);
await rm(output,{recursive:true,force:true});
await mkdir(output,{recursive:true});
for(const entry of ['assets','src','vendor','style.css','blackmere.webmanifest','third-party-notices.txt']){
  await cp(new URL(entry,source),new URL(entry,output),{recursive:true});
}
const html=await readFile(new URL('index.html',source),'utf8');
if(!html.includes('<html lang="en">'))throw new Error('Could not enable the guest edition.');
await writeFile(new URL('index.html',output),html
  .replace('<html lang="en">','<html lang="en" data-edition="guest">')
  .replace(' with verified escape rankings',''));
