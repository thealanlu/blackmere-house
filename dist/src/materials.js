import * as T from '../vendor/three.module.js';
export function rng(seed=17) {
  return () => ((seed = Math.imul(seed,1664525)+1013904223 >>> 0) / 4294967296);
}
function image(draw,w=512,h=512) {
  if(!globalThis.document)return null;
  const c=Object.assign(document.createElement('canvas'),{width:w,height:h});
  draw(c.getContext('2d'),w,h,rng(39131));
  const tex=new T.CanvasTexture(c);tex.colorSpace=T.SRGBColorSpace;tex.anisotropy=8;
  tex.wrapS=tex.wrapT=T.RepeatWrapping;return tex;
}
function grit(g,w,h,random,opacity=.18) {
  for(let i=0;i<27000;i++) {
    g.fillStyle=random()<.5?`rgba(5,8,7,${random()*opacity})`:`rgba(216,205,177,${random()*opacity})`;
    g.fillRect(random()*w,random()*h,random()*3.6+.5,random()*2.1+.5);
  }
}
function woodTexture(floor=false) {
  return image((g,w,h,r)=>{
    g.fillStyle='#31241c';g.fillRect(0,0,w,h);
    const columns=floor?8:4,width=w/columns;
    for(let n=0;n<columns;n++) {
      const x=n*width;
      const parts=floor?[-h+(n*173)%h,(n*173)%h,h+(n*173)%h]:[-2,h];
      for(let a=0;a<parts.length-1;a++) {
        const y=parts[a],dy=parts[a+1]-y-1,d=r()*11;
        const paint=g.createLinearGradient(x,0,x+width,0);
        paint.addColorStop(0,'#281f18');
        paint.addColorStop(.07,`rgb(${79+d},${55+d},${38+d})`);
        paint.addColorStop(.7,`rgb(${63+d},${44+d},${32+d})`);
        paint.addColorStop(1,'#292019');
        g.fillStyle=paint;g.fillRect(x+1,y+1,width-1,dy);
        for(let j=0;j<65;j++) {
          const px=x+r()*width,py=y+r()*dy,l=10+r()*dy;
          g.strokeStyle=r()>.5?`rgba(20,12,7,${r()*.33})`:`rgba(167,127,86,${r()*.24})`;
          g.lineWidth=.3+r()*1.3;g.beginPath();g.moveTo(px,py);g.bezierCurveTo(px-6,py+l*.25,px+9,py+l*.58,px+1,py+l);g.stroke();
        }
        g.fillStyle='#211a16';g.fillRect(x+width*.2,y+8,2,3);g.fillRect(x+width*.8,y+8,2,3);
      }
    }
    grit(g,w,h,r);
  });
}
const wood=woodTexture(), floorMap=woodTexture(true);
const paper=image((g,w,h,r)=>{
  g.fillStyle='#465147';g.fillRect(0,0,w,h);
  for(let x=0;x<w;x+=64) {
    g.fillStyle='#73827018';g.fillRect(x+3,0,24,h);
    g.fillStyle='#242e2790';g.fillRect(x+31,0,1,h);
    g.fillStyle='#b0a88c2e';g.fillRect(x+34,0,1,h);
  }
  for(let y=-35;y<h+35;y+=128)for(let x=16;x<w+33;x+=64) {
    const yy=y+((x-16)%128?64:0);
    g.strokeStyle='#9a97734a';g.lineWidth=1.5;
    g.beginPath();g.moveTo(x,yy-32);g.bezierCurveTo(x-37,yy-13,x-27,yy+21,x,yy+39);
    g.bezierCurveTo(x+27,yy+21,x+37,yy-13,x,yy-32);g.stroke();
    for(const s of [-1,1]) {
      g.beginPath();g.moveTo(x,yy+25);g.quadraticCurveTo(x+s*30,yy-7,x+s*4,yy-11);g.quadraticCurveTo(x+s*15,yy+1,x,yy+8);g.stroke();
    }
    g.fillStyle='#a59f7d47';g.beginPath();g.ellipse(x,yy-12,3,9,0,0,7);g.fill();
  }
  for(let i=0;i<68;i++) {
    const x=r()*w,y=r()*h,k=7+r()*67;
    const shade=g.createRadialGradient(x,y,0,x,y,k);
    shade.addColorStop(0,r()>.5?'#161a1a5e':'#9a816a3a');shade.addColorStop(1,'transparent');
    g.fillStyle=shade;g.fillRect(x-k,y-k,k*2,k*2);
  }
  for(let i=0;i<12;i++) {
    const x=r()*w,y=r()*h;
    g.fillStyle='#8a79614e';g.beginPath();g.moveTo(x,y);
    for(let j=0;j<8;j++)g.lineTo(x+r()*21,y+j*(2+r()*7));
    g.closePath();g.fill();
  }
  grit(g,w,h,r,.22);
});
const stone=image((g,w,h,r)=>{
  g.fillStyle='#272e2d';g.fillRect(0,0,w,h);
  for(let y=-1;y<8;y++)for(let x=-1;x<4;x++) {
    const px=x*128+(y%2)*64,py=y*64,v=Math.round(52+r()*21);
    g.fillStyle=`rgb(${v},${v+2},${v-4})`;g.fillRect(px+2,py+2,124,59);
    g.fillStyle='#b1b7aa37';g.fillRect(px+4,py+2,119,2);
    g.fillStyle='#1519184c';g.fillRect(px+4,py+55,122,5);
    for(let i=0;i<50;i++) {
      g.fillStyle=i%3?'#242b292a':'#9a9b843e';
      g.fillRect(px+r()*120,py+r()*58,r()*18+1,r()*4+1);
    }
  }
  grit(g,w,h,r,.25);
});
const tile=image((g,w,h,r)=>{
  g.fillStyle='#272c29';g.fillRect(0,0,w,h);
  for(let y=0;y<8;y++)for(let x=0;x<8;x++) {
    const v=Math.round(((x+y)%2?85:51)+r()*14);
    g.fillStyle=`rgb(${v},${v+3},${v-3})`;g.fillRect(x*64+2,y*64+2,60,60);
    g.fillStyle='#b8b09c41';g.fillRect(x*64+3,y*64+3,57,1);
  }
  grit(g,w,h,r);
});
const rug=image((g,w,h,r)=>{
  g.fillStyle='#603c38';g.fillRect(0,0,w,h);
  for(let i=0;i<35;i+=6) {g.strokeStyle=i%12?'#8f7458':'#271c1b';g.lineWidth=3;g.strokeRect(9+i,9+i,w-18-i*2,h-18-i*2);}
  for(let y=68;y<h-40;y+=48)for(let x=68;x<w-40;x+=48) {
    g.fillStyle='#96785880';g.beginPath();g.moveTo(x,y-20);g.lineTo(x+17,y);g.lineTo(x,y+20);g.lineTo(x-17,y);g.closePath();g.fill();
    g.strokeStyle='#382924';g.stroke();g.fillStyle='#b6a3818e';g.fillRect(x-2,y-2,4,4);
  }
  grit(g,w,h,r,.29);
},256,512);
const plaster=image((g,w,h,r)=>{
  g.fillStyle='#64655a';g.fillRect(0,0,w,h);
  for(let i=0;i<65;i++) {
    const x=r()*w,y=r()*h,a=22+r()*110;
    const gradient=g.createRadialGradient(x,y,0,x,y,a);
    gradient.addColorStop(0,i%2?'#242a2856':'#b6aa8c39');gradient.addColorStop(1,'transparent');
    g.fillStyle=gradient;g.fillRect(x-a,y-a,a*2,a*2);
  }
  grit(g,w,h,r);
});
const fabric=image((g,w,h,r)=>{
  g.fillStyle='#797d71';g.fillRect(0,0,w,h);
  for(let i=0;i<w;i+=2){g.fillStyle='#242e2a49';g.fillRect(i,0,1,h);g.fillRect(0,i,w,1);}
  grit(g,w,h,r,.24);
},256,256);
export const mat=(color,options={})=>new T.MeshStandardMaterial({color,roughness:.91,...options});
const mapped=(map,color=0xffffff,bumpScale=.04)=>mat(color,{map,bumpMap:map,bumpScale});
export const materials={
  floor:mapped(floorMap),wall:mapped(paper,0xffffff,.026),stone:mapped(stone),tile:mapped(tile),ceiling:mapped(plaster,0x939993),wood:mapped(wood),
  darkWood:mapped(wood,0x76695e),trim:mat(0x362c24),black:mat(0x171919),
  brass:mat(0x8d714b,{metalness:.63,roughness:.44}),iron:mat(0x394647,{metalness:.76,roughness:.49}),
  rust:mat(0x745043,{metalness:.31}),linen:mapped(fabric,0xe3d6b5,.02),green:mapped(fabric,0x697365,.018),red:mapped(fabric,0x794844,.018),
  rug:mapped(rug,0xb4a7a4,.019),paper:mat(0xa99470),glass:mat(0x678b8b,{roughness:.4,emissive:0x52696d,emissiveIntensity:.52}),
  glow:mat(0xb7824d,{emissive:0x9a5729,emissiveIntensity:1.1}),
  cold:mat(0x768a88,{emissive:0x557c83,emissiveIntensity:1.25}),
};
const originalImages=new Map();
export function setMaterialQuality(edge) {
  const changed=new Set();
  for(const material of Object.values(materials)) {
    const tex=material.map;
    if(!tex)continue;
    if(!changed.has(tex)) {
      changed.add(tex);
      const original=originalImages.get(tex)??tex.image;
      originalImages.set(tex,original);
      const scale=Math.min(1,edge/Math.max(original.width,original.height));
      if(scale===1)tex.image=original;
      else {
        const canvas=Object.assign(document.createElement('canvas'),{width:Math.round(original.width*scale),height:Math.round(original.height*scale)});
        canvas.getContext('2d').drawImage(original,0,0,canvas.width,canvas.height);tex.image=canvas;
      }
      tex.anisotropy=edge>=512?8:edge>=384?4:1;tex.needsUpdate=true;
    }
    const bump=edge>=384?tex:null;
    if(material.bumpMap!==bump){material.bumpMap=bump;material.needsUpdate=true;}
  }
}
