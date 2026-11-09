import * as T from '../vendor/three.module.js';
import { uv } from './face-topology.js';

export const oval = [10,338,297,332,284,251,389,356,454,323,361,288,397,365,379,378,400,377,152,148,176,149,150,136,172,58,132,93,234,127,162,21,54,103,67,109];
const size = 640;
const pixel = ([u, v]) => [u * size, (1 - v) * size];
const points = uv.map(pixel);
const canvas = (width = size, height = width) => Object.assign(document.createElement('canvas'), {width, height});
const base = canvas();
const mix = (a,b,t) => a+(b-a)*t;

function trace(context, indices) {
  context.beginPath();
  indices.forEach((i, n) => context[n ? 'lineTo' : 'moveTo'](...points[i]));
  context.closePath();
}

function paintSkin() {
  const g = base.getContext('2d');
  const data = g.createImageData(size,size);
  let seed = 38161;
  const rand = () => ((seed = Math.imul(seed,1664525)+1013904223 >>> 0) / 4294967296);
  for (let y=0; y<size; y++) for (let x=0; x<size; x++) {
    const i = (y*size+x)*4;
    const mottling = Math.sin(x*.031+y*.043)*3 + Math.sin(x*.071-y*.019)*2 + Math.sin(x*.008-y*.014)*5;
    const grain = (rand()-.5)*11 + mottling;
    data.data[i]=134+grain;
    data.data[i+1]=115+grain*.86;
    data.data[i+2]=104+grain*.92;
    data.data[i+3]=255;
  }
  g.putImageData(data,0,0);
  function shade(x,y,r,color) {
    const gradient=g.createRadialGradient(x,y,1,x,y,r);
    gradient.addColorStop(0,color); gradient.addColorStop(1,'transparent');
    g.fillStyle=gradient; g.fillRect(x-r,y-r,r*2,r*2);
  }
  shade(221,238,70,'rgba(33,23,37,.7)');
  shade(419,238,70,'rgba(33,23,37,.7)');
  shade(320,353,55,'rgba(145,70,64,.46)');
  shade(196,326,54,'rgba(95,43,49,.38)');
  shade(444,326,54,'rgba(95,43,49,.38)');
  for (let i=0;i<480;i++) {
    const x=rand()*size,y=rand()*size;
    g.fillStyle=i%7===0?'#64494337':'#503a3325';
    g.beginPath();g.ellipse(x,y,.5+rand()*2.8,.6+rand()*1.3,rand()*Math.PI,0,Math.PI*2);g.fill();
  }
  function wrinkle(x,y,cx,cy,ex,ey,opacity=.27) {
    for (const delta of [0,1.8]) {
      g.strokeStyle=delta ? 'rgba(235,199,168,.22)' : `rgba(51,35,31,${opacity})`;
      g.lineWidth=delta ? 1.2 : 1.8;
      g.beginPath();g.moveTo(x,y+delta);g.quadraticCurveTo(cx,cy+delta,ex,ey+delta);g.stroke();
    }
  }
  for(let j=0;j<6;j++) wrinkle(218+j*4,111+j*12,324,86+j*14,423-j*4,110+j*12,.36);
  for(const s of [-1,1]) {
    for(let j=0;j<6;j++) {
      wrinkle(320+s*(116+j*2),240+j*5,320+s*(152+j*2),242+j*6,320+s*(167+j*3),256+j*7);
      wrinkle(320+s*43,251+j*5,320+s*92,278+j*6,320+s*129,259+j*6);
    }
    for(let j=0;j<4;j++) wrinkle(320+s*(45+j*6),337+j*3,320+s*(84+j*9),370,320+s*(79+j*10),428+j*5,.32);
    for(let j=0;j<3;j++) wrinkle(320+s*(29+j*5),186-j*2,320+s*(20+j*5),163-j*2,320+s*(21+j*5),152-j*2,.29);
    const eye = s<0?[33,160,158,133,153,144]:[362,385,387,263,373,380];
    trace(g,eye);g.fillStyle='#2c2227';g.fill();
    const brow=s<0?[70,63,105,66,107]:[336,296,334,293,300];
    for(let j=0;j<95;j++) {
      const n=Math.floor(rand()*4), t=rand(), a=points[brow[n]], b=points[brow[n+1]];
      const x=mix(a[0],b[0],t),y=mix(a[1],b[1],t)+rand()*7;
      g.strokeStyle=j%4?'#342a2a91':'#d2c2ad9a';g.lineWidth=.65;
      g.beginPath();g.moveTo(x,y);g.lineTo(x+s*(3+rand()*7),y-2-rand()*4);g.stroke();
    }
  }
  trace(g,[61,40,37,0,267,270,291,321,314,17,84,91]);g.fillStyle='#705050';g.fill();
  trace(g,[78,82,13,312,308,317,14,87]);g.fillStyle='#301f24';g.fill();
}

paintSkin();
export const skinDetail=new T.CanvasTexture(base);
skinDetail.anisotropy=8;

export function loadSkin(material) {
  material.map=skinDetail.clone();material.map.colorSpace=T.SRGBColorSpace;material.map.needsUpdate=true;
  new T.TextureLoader().load(new URL('../assets/caretaker-albedo.webp',import.meta.url).href,texture=>{
    texture.colorSpace=T.SRGBColorSpace;texture.anisotropy=8;
    material.map.dispose();material.map=texture;material.needsUpdate=true;
  },undefined,()=>{});
}

