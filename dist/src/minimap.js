import level from './level-data.js';
import {areas,clamp,floorAt,DOOR_ALERT_MS} from './rules.js';

import {floors,stairs,stairWidth,wingRooms} from './floors.js';

const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const duration=DOOR_ALERT_MS;
const labels=['BEDROOM','MUSIC','STUDY','DRAWING','KITCHEN','STAIRS'];
const doorColors={wall:'#a69f89',unknown:'#7b8173',locked:'#d09a70',open:'#86ae92',closed:'#dacdb2',arch:'#617367'};

export function mansionMap({canvas,floorLabel,button,notice},settings) {
  const ctx=canvas.getContext('2d'),alerts=new Map(),team=new Map(),discovered=new Set();
  let floor='main',current=null,marker=null,lastAlert=null;
  const visited=new Set(['main']);
  const secretLanding=level.passages.find(p=>p.name==='Attic Bookcase');
  function reset() {
    floor='main';current=null;marker=null;lastAlert=null;
    alerts.clear();team.clear();notice.textContent='';label();
  }
  function available() {return floors.filter(f=>visited.has(f.id));}
  function nextFloor() {
    const known=available();
    return known[(known.findIndex(f=>f.id===floor)+1)%known.length];
  }
  function label() {
    const {code,label}=floors.find(f=>f.id===floor);
    const next=nextFloor();
    floorLabel.textContent=code+' · '+label;
    button.textContent=next.code;
    button.disabled=next.id===floor;
    button.setAttribute('aria-label','View '+next.label.toLowerCase()+' map');
  }
  function toggle() {floor=nextFloor().id;label();}
  function alert(index,age=0,stamp=null) {
    const door=level.objects[index],previous=alerts.get(index);
    if(door?.kind!=='door'||age>=duration||stamp!==null&&previous?.stamp===stamp)return;
    alerts.set(index,{opened:performance.now()-Math.max(0,age),stamp});
    lastAlert=index;
    notice.textContent='Granny opened '+door.name+' · '+floors.find(f=>f.id===floorAt(door.x,door.z)).code+'.';
  }
  function line(x,z,x1,z1,color,thickness,dash=[]) {
    ctx.strokeStyle=color;ctx.lineWidth=thickness;ctx.setLineDash(dash);
    ctx.beginPath();ctx.moveTo(x,z);ctx.lineTo(x1,z1);ctx.stroke();ctx.setLineDash([]);
  }
  function dot(x,z,r,color,border) {
    ctx.fillStyle=color;ctx.beginPath();ctx.arc(x,z,r,0,Math.PI*2);ctx.fill();
    if(border){ctx.strokeStyle=border;ctx.stroke();}
  }
  function draw(player,sim,packet,dt) {
    const width=canvas.clientWidth,height=canvas.clientHeight;
    if(!ctx||!width||!height)return;
    const now=performance.now(),atFloor=floorAt(player.x,player.z);
    if(current!==atFloor){current=atFloor;floor=atFloor;visited.add(floor);label();}
    const dpr=Math.min(window.devicePixelRatio||1,2);
    const pixels=[Math.round(width*dpr),Math.round(height*dpr)];
    if(canvas.width!==pixels[0]||canvas.height!==pixels[1]){canvas.width=pixels[0];canvas.height=pixels[1];}
    ctx.setTransform(dpr,0,0,dpr,0,0);
    ctx.clearRect(0,0,width,height);
    ctx.fillStyle='#121916';ctx.fillRect(0,0,width,height);
    const view=floors.find(f=>f.id===floor),cellar=floors[0];
    const scale=Math.min((width-10)/(view.x1-view.x0),(height-8)/(view.z1-view.z0));
    const marginX=(width-(view.x1-view.x0)*scale)/2,marginY=(height-(view.z1-view.z0)*scale)/2;
    ctx.save();ctx.translate(marginX-view.x0*scale,marginY-view.z0*scale);ctx.scale(scale,scale);
    ctx.beginPath();ctx.rect(view.x0,view.z0,view.x1-view.x0,view.z1-view.z0);ctx.clip();
        ctx.fillStyle='#25312a';
    if(floor==='main')ctx.fillRect(-14,-13,28,26);
    if(floor==='cellar')ctx.fillRect(cellar.x0,cellar.z0,cellar.x1-cellar.x0,cellar.z1-cellar.z0);
    if(floor==='main')areas.forEach(([,x0,x1,z0,z1],i)=>{
      ctx.fillStyle=i%2?'#2a342d':'#303b32';ctx.fillRect(x0,z0,x1-x0,z1-z0);
    });
    if(floor==='main') {
      ctx.fillStyle='#17221f';ctx.fillRect(cellar.x0,cellar.z0,cellar.x1-cellar.x0,cellar.z1-cellar.z0);
      line(cellar.x0,-13,cellar.x0,-5.15,'#927c58',.7/scale,[2/scale,2/scale]);
    }
    for(const room of wingRooms)if(room.floor===floor){
      ctx.fillStyle='#303b32';ctx.fillRect(room.x0,room.z0,room.x1-room.x0,room.z1-room.z0);
    }
    for(const s of stairs)if((s.from===floor||s.to===floor)&&(!s.secret||discovered.has(secretLanding.index))) {
      ctx.fillStyle='#485044';ctx.fillRect(s.x0,s.z-stairWidth/2,s.x1-s.x0,stairWidth);
      for(let x=s.x0+.45;x<s.x1;x+=.9)line(x,s.z-stairWidth/2,x,s.z+stairWidth/2,'#8d856c',.65/scale);
    }
    ctx.fillStyle='#a69f89';
    for(const wall of level.walls) {
      if(wall.secret&&!discovered.has(secretLanding.index))continue;
      const dx=Math.max(wall.dx,1.1/scale),dz=Math.max(wall.dz,1.1/scale);
      ctx.fillRect(wall.x-dx/2,wall.z-dz/2,dx,dz);
    }
    ctx.fillStyle='#adaf9d';ctx.textAlign='center';ctx.textBaseline='middle';
    ctx.font='600 '+(Math.max(5.5,Math.min(8,width*.047))/scale)+'px system-ui';
    if(floor==='main') {
      areas.forEach(([,x0,x1,z0,z1],i)=>ctx.fillText(labels[i],i===5?4.75:(x0+x1)/2,(z0+z1)/2));
      ctx.fillText('HALL',0,3.2);
    }else if(floor==='cellar'){
      ctx.fillText('CELLAR',10.8,-8);
      ctx.fillText('BOILER',11,-11.8);
    }else for(const room of wingRooms)if(room.floor===floor) {
      const names=room.name.toUpperCase().split(' ');
      names.forEach((name,i)=>ctx.fillText(name,(room.x0+room.x1)/2,(room.z0+room.z1)/2+(i-.5)*9/scale));
    }
    const {objects}=sim.world,{progress}=sim.state;
    const hunter=packet?.me.role==='granny',bolts=packet?.bolts??[];
    for(const portal of level.passages) {
      if(floorAt(portal.x,portal.z)!==floor)continue;
      const door=objects[portal.index],drain=portal.name==='Drain Exit';
      if(door?.secret&&door.open)discovered.add(portal.index);
      const dxToDoor=portal.x-player.x,dzToDoor=portal.z-player.z,distance=Math.hypot(dxToDoor,dzToDoor);
      const nearEdge=Math.max(0,1-.26/(distance||1));
      const known=!hunter||distance<5&&sim.nav.clear(player.x,player.z,player.x+dxToDoor*nearEdge,player.z+dzToDoor*nearEdge);
      const locked=drain?!progress.handle:door?.kind==='front'?!progress.unlock:bolts.includes(portal.index);
      const state=door?.secret&&!discovered.has(portal.index)?'wall':!known&&(door||drain)?'unknown':
        locked?'locked':door?(door.open?'open':'closed'):drain?'open':'arch';
      const span=portal.width/2,dx=portal.axis==='x'?span:0,dz=portal.axis==='x'?0:span;
      const dash=state==='open'||state==='arch'?[1.9/scale,1.4/scale]:[];
      line(portal.x-dx,portal.z-dz,portal.x+dx,portal.z+dz,doorColors[state],(state==='locked'?2.15:1.55)/scale,dash);
      if(state==='locked')dot(portal.x,portal.z,1.45/scale,doorColors.locked);
    }
    const blend=settings.motion?1-Math.exp(-17*dt):1;
    if(!marker||Math.hypot(marker.x-player.x,marker.z-player.z)>3.2)marker={x:player.x,z:player.z,yaw:player.yaw};
    marker.x+=(player.x-marker.x)*blend;marker.z+=(player.z-marker.z)*blend;
    marker.yaw+=wrap(player.yaw-marker.yaw)*blend;
    const nearby=new Set(),across=[];
    const floorRank=id=>floors.findIndex(f=>f.id===id);
    for(const [index,data] of alerts) {
      if(now-data.opened<duration&&floorAt(objects[index].x,objects[index].z)!==floor)
        across.push(floors.find(f=>f.id===floorAt(objects[index].x,objects[index].z)).code);
    }
    const signals=[...new Set(across)];
    if(signals.length) {
      ctx.textAlign='right';ctx.fillStyle='#fa8275';
      ctx.fillText(signals.join(' · '),view.x1-.4,view.z0+1);
    }
    const teamLevels=new Set();
    for(const p of packet?.mapTeam??[]) {
      nearby.add(p.id);
      const saved=team.get(p.id)??{...p};
      saved.x+=(p.x-saved.x)*blend;saved.z+=(p.z-saved.z)*blend;team.set(p.id,saved);
      const peerFloor=floorAt(p.x,p.z);
      if(peerFloor!==floor){teamLevels.add(floorRank(peerFloor)>floorRank(floor)?'↑':'↓');continue;}
      ctx.lineWidth=1/scale;dot(saved.x,saved.z,(width<125?2.65:3.3)/scale,p.down?'#cf916d':'#80c9be','#101815');
    }
    if(teamLevels.size){
      ctx.textAlign='left';ctx.fillStyle='#80c9be';
      ctx.fillText([...teamLevels].join(' '),view.x0+.4,view.z0+1);
    }
    for(const id of team.keys())if(!nearby.has(id))team.delete(id);
    for(const [index,data] of alerts) {
      const age=now-data.opened;
      if(age>=duration){alerts.delete(index);continue;}
      if(hunter)continue;
      const door=objects[index];
      if(floorAt(door.x,door.z)!==floor)continue;
      ctx.globalAlpha=clamp((duration-age)/1000,0,1);
      const pulse=settings.motion?(1+Math.sin(age*.012))*.5:.35;
      ctx.strokeStyle='rgba(255,96,90,.7)';ctx.lineWidth=1.3/scale;
      ctx.beginPath();ctx.arc(door.x,door.z,(3.6+pulse*2.3)/scale,0,Math.PI*2);ctx.stroke();
      dot(door.x,door.z,1.75/scale,'#fa8275');ctx.globalAlpha=1;
    }
    if(lastAlert!==null&&!alerts.has(lastAlert)){lastAlert=null;notice.textContent='';}
    if(floor===current) {
      ctx.save();ctx.translate(marker.x,marker.z);ctx.rotate(-marker.yaw);
      const r=(width<125?4.7:5.5)/scale;
      ctx.fillStyle=hunter?'#e7c1a8':'#f3daa5';ctx.strokeStyle='#111915';ctx.lineWidth=1.3/scale;
      ctx.beginPath();ctx.moveTo(0,-r);ctx.lineTo(r*.65,r*.75);ctx.lineTo(0,r*.35);ctx.lineTo(-r*.65,r*.75);ctx.closePath();
      ctx.fill();ctx.stroke();ctx.restore();
    }
    ctx.restore();
  }
  button.onclick=toggle;
  label();
  return {draw,reset,alert,toggle};
}
