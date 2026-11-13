import {bounds as expandedBounds,oldBounds} from './rules.js';
import {stairs,stairWidth} from './floors.js';

const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
const gap=.5;
const grids=new WeakMap();

export function navigation(world) {
  const bounds=world.geometry?.expanded?expandedBounds:oldBounds;
  const cols=Math.ceil((bounds.x1-bounds.x0)/gap),rows=52;
  const bucketSize=2, buckets=new Map();
  const bucketKey=(x,z)=>x*128+z;
  for(const o of world.solid) {
    for(let x=Math.floor((o.x-o.dx/2-.35)/bucketSize);x<=Math.floor((o.x+o.dx/2+.35)/bucketSize);x++) {
      for(let z=Math.floor((o.z-o.dz/2-.35)/bucketSize);z<=Math.floor((o.z+o.dz/2+.35)/bucketSize);z++) {
        const k=bucketKey(x,z);
        if(!buckets.has(k))buckets.set(k,[]);
        buckets.get(k).push(o);
      }
    }
  }
  const nearby=(x,z)=>buckets.get(bucketKey(Math.floor(x/bucketSize),Math.floor(z/bucketSize)))??[];
  const inFootprint=(x,z)=>x<14||(x>=23&&x<36||x>=45)&&z>=-8&&z<=12||
    stairs.some(s=>x>=s.x0&&x<=s.x1&&Math.abs(z-s.z)<=stairWidth/2);
  const normalDoors=world.doors.filter(d=>d.kind==='door'&&!d.secret);
  const doorBlocks=new Set(normalDoors.map(d=>d.blocker));
  function blocked(x,z,r=.23,navigating=false) {
    if(x-r<bounds.x0||x+r>bounds.x1||z-r<bounds.z0||z+r>bounds.z1)return true;
    if(world.geometry?.expanded&&!inFootprint(x,z))return true;
    return nearby(x,z).some(o=>{
      if(o.enabled===false||(navigating&&doorBlocks.has(o)))return false;
      const dx=x-clamp(x,o.x-o.dx/2,o.x+o.dx/2),dz=z-clamp(z,o.z-o.dz/2,o.z+o.dz/2);
      return dx*dx+dz*dz<r*r;
    });
  }
  function clear(ax,az,bx,bz,radius=.035,navigating=false) {
    const dx=bx-ax,dz=bz-az,steps=Math.ceil(Math.hypot(dx,dz)/.14);
    for(let i=1;i<steps;i++)if(blocked(ax+dx*i/steps,az+dz*i/steps,radius,navigating))return false;
    return true;
  }
  function doorAhead(x,z,dx,dz) {
    let nearest=null,first=1;
    for(const door of normalDoors) {
      if(door.open)continue;
      const acrossX=door.axis==='z',block=door.blocker;
      const t=acrossX?(block.x-x)/dx:(block.z-z)/dz;
      if(!(t>0&&t<=first))continue;
      const offset=acrossX?z+dz*t-block.z:x+dx*t-block.x;
      if(Math.abs(offset)>(acrossX?block.dz:block.dx)/2-.12)continue;
      const approach=Math.max(0,t-.15/Math.hypot(dx,dz));
      if(!clear(x,z,x+dx*approach,z+dz*approach))continue;
      nearest=door;first=t;
    }
    return nearest;
  }
  function move(body,dx,dz,r=.23) {
    if(!blocked(body.x+dx,body.z,r))body.x+=dx;
    if(!blocked(body.x,body.z+dz,r))body.z+=dz;
  }
  const point=i=>[bounds.x0+(i%cols+.5)*gap,bounds.z0+(Math.floor(i/cols)+.5)*gap];
  const geometry=world.geometry??world;
  let staticGrid=grids.get(geometry);
  if(!staticGrid) {
    staticGrid=Array.from({length:cols*rows},(_,i)=>{
      const [x,z]=point(i);
      return (world.geometry?.expanded&&!inFootprint(x,z))||nearby(x,z).some(o=>o.enabled===undefined&&Math.hypot(
        x-clamp(x,o.x-o.dx/2,o.x+o.dx/2),z-clamp(z,o.z-o.dz/2,o.z+o.dz/2))<.29);
    });
    grids.set(geometry,staticGrid);
  }
  const special=world.doors.filter(d=>!doorBlocks.has(d.blocker)).map(d=>d.blocker);
  function occupied(i) {
    if(i<0||i>=cols*rows||staticGrid[i])return true;
    const [x,z]=point(i);
    return special.some(o=>o.enabled&&Math.abs(o.x-x)<o.dx/2+.23&&Math.abs(o.z-z)<o.dz/2+.23);
  }
  function nearest(x,z) {
    const cx=clamp(Math.floor((x-bounds.x0)/gap),0,cols-1),cz=clamp(Math.floor((z-bounds.z0)/gap),0,rows-1);
    for(let r=0;r<=5;r++) {
      let best=-1,dist=Infinity;
      for(let a=Math.max(0,cx-r);a<=Math.min(cols-1,cx+r);a++) for(let b=Math.max(0,cz-r);b<=Math.min(rows-1,cz+r);b++) {
        const i=b*cols+a;
        if(occupied(i))continue;
        const [px,pz]=point(i),d=(x-px)**2+(z-pz)**2;
        if(d<dist){best=i;dist=d;}
      }
      if(best>=0)return best;
    }
    return -1;
  }
  function path(ax,az,bx,bz) {
    const start=nearest(ax,az),end=nearest(bx,bz);
    if(start<0||end<0)return [];
    const [ex,ez]=point(end);
    const scores=new Float32Array(cols*rows).fill(Infinity);
    const visited=new Uint8Array(cols*rows),parent=new Int16Array(cols*rows).fill(-1);
    const open=[[start,0]];
    scores[start]=0;
    let reached=false;
    while(open.length) {
      let best=0;
      for(let k=1;k<open.length;k++)if(open[k][1]<open[best][1])best=k;
      const i=open[best][0];open[best]=open[open.length-1];open.pop();
      if(visited[i])continue;
      if(i===end){reached=true;break;}
      visited[i]=1;
      const x=i%cols,z=Math.floor(i/cols);
      for(const [dx,dz] of [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]]) {
        if(x+dx<0||x+dx>=cols||z+dz<0||z+dz>=rows)continue;
        const j=i+dx+dz*cols;
        if(visited[j]||occupied(j)||(dx&&dz&&(occupied(i+dx)||occupied(i+dz*cols))))continue;
        const score=scores[i]+(dx&&dz?1.4142135:1);
        if(score>=scores[j])continue;
        const [px,pz]=point(j);
        scores[j]=score;parent[j]=i;
        open.push([j,score+Math.hypot(px-ex,pz-ez)/gap]);
      }
    }
    if(!reached)return [];
    const route=[];
    for(let i=end;i!==start;i=parent[i])route.push(point(i));
    route.reverse();
    if(!blocked(bx,bz,.28,true)&&clear(ex,ez,bx,bz,.23,true))route.push([bx,bz]);
    const [sx,sz]=point(start);
    const first=route[0];
    if(first&&!clear(ax,az,...first,.23,true))route.unshift([sx,sz]);
    return route;
  }
  function beamReach(x,z,yaw,max=19) {
    const dx=-Math.sin(yaw),dz=-Math.cos(yaw);
    for(let d=.24;d<max;d+=.21)if(blocked(x+dx*d,z+dz*d,.075))return Math.max(.36,d+.16);
    return max;
  }
  return {blocked,clear,move,path,doorAhead,beamReach};
}
