import assert from 'node:assert/strict';
import level from '../dist/src/level-data.js';
import {areaAt,areas,bounds,SPAWN} from '../dist/src/rules.js';
import {stairs,wingRooms} from '../dist/src/floors.js';
import {createSimulation} from '../dist/src/simulation.js';

export function validateMansion() {
  const {nav,world}=createSimulation(100,'normal');
  const rooms=[...areas.map(([name])=>name),'Grand Hall','Boiler Room',...wingRooms.map(r=>r.name)];
  const edges=[];
  for(const portal of level.passages) {
    const object=world.objects[portal.index];
    if(object?.kind==='front'||portal.name==='Drain Exit'||!object&&portal.name.includes('Stair'))continue;
    const dx=portal.axis==='z'?.63:0,dz=portal.axis==='x'?.63:0;
    const from=[portal.x-dx,portal.z-dz],to=[portal.x+dx,portal.z+dz];
    assert.ok(!nav.blocked(...from)&&!nav.blocked(...to),portal.name+' has a blocked approach');
    const crossed=()=>nav.clear(...from,...to,.23);
    if(object) {
      assert.ok(!crossed(),portal.name+' must block passage when closed or bolted');
      object.blocker.enabled=false;
      assert.ok(crossed(),portal.name+' must be traversable when open');
      object.blocker.enabled=true;
    } else assert.ok(crossed(),portal.name+' must be traversable');
    if(!object?.secret)edges.push({from,to,rooms:[areaAt(...from),areaAt(...to)],object,name:portal.name});
  }
  for(const stair of stairs.filter(s=>!s.secret)) {
    const {x0,x1,z}=stair,from=[x0-.45,z],to=[x1+.45,z];
    assert.ok(!nav.blocked(...from)&&!nav.blocked(...to)&&nav.clear(...from,...to,.23),'Stair corridor is blocked');
    assert.ok(nav.path(...from,...to).length,'Stair is unavailable to Granny');
    edges.push({from,to,rooms:[areaAt(...from),areaAt(...to)],name:stair.from+' to '+stair.to});
  }
  function graph(exclude) {
    const adjacency=new Map(rooms.map(room=>[room,new Set()]));
    for(const edge of edges) {
      if(edge===exclude)continue;
      const [a,b]=edge.rooms;
      assert.notEqual(a,b,edge.name+' must join separate rooms');
      adjacency.get(a).add(b);adjacency.get(b).add(a);
    }
    return adjacency;
  }
  for(const room of rooms)assert.ok(edges.filter(edge=>edge.rooms.includes(room)).length>=2,room+' needs two usable entrances');
  for(const closed of [null,...edges]) {
    const connected=graph(closed),visited=new Set(['Grand Hall']),queue=['Grand Hall'];
    for(const room of queue)for(const next of connected.get(room))if(!visited.has(next)){visited.add(next);queue.push(next);}
    assert.equal(visited.size,rooms.length,'Mansion disconnected with '+(closed?.name??'ordinary routes')+' closed');
  }
  // Probe the actual collision grid with openable doors open and both objectives still locked.
  for(const edge of edges)if(edge.object)edge.object.blocker.enabled=false;
  const cell=.4,cols=Math.ceil((bounds.x1-bounds.x0)/cell),rows=Math.ceil((bounds.z1-bounds.z0)/cell);
  const xy=(x,z)=>[bounds.x0+(x+.5)*cell,bounds.z0+(z+.5)*cell];
  const free=Array.from({length:cols*rows},(_,i)=>!nav.blocked(...xy(i%cols,Math.floor(i/cols))));
  function closest(point) {
    let best=-1,range=.65;
    for(let i=0;i<free.length;i++) {
      if(!free[i])continue;
      const p=xy(i%cols,Math.floor(i/cols)),distance=Math.hypot(p[0]-point[0],p[1]-point[1]);
      if(distance<range&&nav.clear(...point,...p,.23)){range=distance;best=i;}
    }
    return best;
  }
  const start=closest([SPAWN.x,SPAWN.z]),queue=[start],reached=new Set(queue);
  assert.ok(start>=0);
  for(const i of queue) {
    const x=i%cols,z=Math.floor(i/cols);
    for(const [dx,dz] of [[0,-1],[0,1],[-1,0],[1,0]]) {
      const nx=x+dx,nz=z+dz,j=nz*cols+nx;
      if(nx<0||nx>=cols||nz<0||nz>=rows||!free[j]||reached.has(j)||!nav.clear(...xy(x,z),...xy(nx,nz),.23))continue;
      reached.add(j);queue.push(j);
    }
  }
  for(const edge of edges)for(const approach of [edge.from,edge.to]) {
    assert.ok(reached.has(closest(approach)),edge.name+' has an inaccessible approach');
  }
  for(const spot of world.hiding) {
    assert.ok(!nav.blocked(...spot.exit)&&reached.has(closest(spot.exit)),spot.name+' has no safe way out');
    assert.ok(!nav.blocked(...spot.peek,.035),spot.name+' has a blocked sight opening');
  }
  for(const item of world.items)for(const raw of [
    ...level.itemSpots[item.spawn??item.id],...(level.nightmareSpots[item.id]??[])
  ]) {
    const entry=typeof raw==='number'?world.objects[raw]:raw;
    const usable=Array.from({length:24},(_,i)=>{
      const angle=i*Math.PI/12;
      return [entry.x+1.25*Math.cos(angle),entry.z+1.25*Math.sin(angle)];
    }).some(at=>reached.has(closest(at)));
    assert.ok(usable,item.name+' has an unreachable spawn');
  }
  return {rooms:rooms.length,routes:edges.length,hiding:world.hiding.length};
}
