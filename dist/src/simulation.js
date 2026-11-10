import mansion from './level-data.js';
import oldMansion from './level-legacy.js';
import {clamp,floorY,SPAWN,TICK,levels,PRE_LAYOUT_RUN_VERSION,RUN_VERSION} from './rules.js';
import {navigation} from './navigation.js';
import {createStalker} from './stalker.js';
import {HIDE_EXIT_TICKS,hideHeading,limitHideLook} from './hide-view.js';

export const key={forward:1,back:2,left:4,right:8,sprint:16};
export const action={use:1,drop:2,crouch:4,light:8,wake:16};
const emptyProgress=()=>({cut:false,unlock:false,power:false,handle:false});
const emptyPlayer=()=>({x:SPAWN.x,z:SPAWN.z,crouch:false,hidden:null,yaw:SPAWN.yaw,pitch:-.015,eye:1.66});
const interval=(x,t)=>x+(t-x)*(1-Math.exp(-12*TICK));
const seatFields=['stamina','tired','step','flash','hiddenFrom','inventory','selected'];

export function createSimulation(seed,difficulty,saved=null,notify=()=>{},party=null,physicsVersion=RUN_VERSION) {
  if(!Object.hasOwn(levels,difficulty))throw new Error('Unknown difficulty');
  const safeHiding=physicsVersion>PRE_LAYOUT_RUN_VERSION;
  const blueprint=safeHiding?mansion:oldMansion;
  const state=saved??{
    tick:0,rng:seed>>>0,day:1,mode:'play',route:null,player:emptyPlayer(),brain:{actor:{x:0,z:0}},
    progress:emptyProgress(),inventory:[],selected:0,flying:[],stamina:1,tired:false,step:0,flash:true,hiddenFrom:null
  };
  let player=state.player;
  const solid=blueprint.solid.map(o=>({...o}));
  const objects=blueprint.objects.map((o,index)=>({
    ...o,index,blocker:o.blocker===undefined?null:solid[o.blocker],
    ...(safeHiding&&(o.blocker!==undefined||o.panels||o.kind==='drawer')?{open:false}:{})
  }));
  const doors=objects.filter(o=>o.blocker);
  const items=objects.filter(o=>o.kind==='item');
  const hiding=objects.filter(o=>o.kind==='hide');
  const world={geometry:blueprint,solid,objects,doors,hiding,items,setContainer};
  const nav=navigation(world);
  const enemy=createStalker(world,nav,state.brain,random,emit,toggleDoor,caught,physicsVersion);
  const hidden=()=>player.hidden===null?null:objects[player.hidden];
  const issue=text=>notify('toast',text);

  function random() {
    state.rng=(Math.imul(state.rng,1664525)+1013904223)>>>0;
    return state.rng/4294967296;
  }
  function emit(kind,at,radius=0) {
    if(at&&radius)enemy.hear(at.x,at.z,radius);
    notify('sound',{kind,at});
  }
  function setContainer(o,open) {
    o.open=open;
    for(const it of items)if(it.available&&it.container===o.index&&o.kind==='drawer') {
      it.x=o.x+Math.sin(o.drawerAngle)*.09;it.z=o.z+Math.cos(o.drawerAngle)*.09;
    }
  }
  function toggleDoor(d,open,fromEnemy=false,source) {
    if(d.open===open||(!open&&Math.hypot(player.x-d.x,player.z-d.z)<.55))return;
    if(!open&&party?.occupied(d))return;
    d.open=open;d.blocker.enabled=!open;
    if(open) {
      const origin=source??(fromEnemy?state.brain.actor:player);
      const side=d.axis==='z'?origin.x-d.x:origin.z-d.z;
      d.swing=(d.axis==='z'?(side<0?-1:1):(side<0?1:-1))*1.71;
      if(fromEnemy&&safeHiding)notify('grannyDoor',{door:d.index});
    }
    emit('door',d,fromEnemy?0:5.4);
  }
  function startNight() {
    Object.assign(player,emptyPlayer());
    if(safeHiding){delete player.hideExit;delete player.hideLeave;}
    Object.assign(state,{mode:'play',stamina:1,tired:false,step:0,flash:true,hiddenFrom:null});
    for(const f of state.flying) {
      const it=objects[f.index];
      it.y=floorY(it.x,it.z)+.075;it.flying=false;
    }
    state.flying=[];
    enemy.reset(difficulty,state.day);
    notify('night',state.day);
  }
  function caught(position) {
    if(state.mode!=='play')return;
    if(party){party.caught(position);return;}
    state.mode=state.day===5?'defeat':'interlude';
    emit('attack',position);notify('caught',position);
  }
  function win(route) {
    if(party){party.escape(route);return;}
    state.mode='victory';state.route=route;
    notify('victory',{route,day:state.day});
  }
  function restoreWorld(patches) {
    for(const [i,patch] of patches) {
      Object.assign(objects[i],patch);
      if(objects[i].blocker)objects[i].blocker.enabled=!objects[i].open;
    }
    solid[blueprint.gate].enabled=!state.progress.handle;
  }
  if(saved)restoreWorld(saved.objects);
  else {
    for(const it of items) {
      const spots=blueprint.itemSpots[it.id],entry=spots[Math.floor(random()*spots.length)];
      const s=typeof entry==='number'?objects[entry]:entry;
      Object.assign(it,{container:s.index??null,x:s.x,y:s.y+(s.kind==='drawer'?.03:s.kind==='cabinet'?-.065:0),z:s.z,available:true,flying:false});
    }
    startNight();
  }

  function use(id) {
    const i=state.inventory.findIndex(index=>objects[index].id===id);
    if(i<0)return false;
    state.inventory.splice(i,1);
    state.selected=clamp(state.selected,0,Math.max(0,state.inventory.length-1));return true;
  }
  function drop() {
    if(hidden()||state.inventory[state.selected]===undefined)return;
    const it=objects[state.inventory[state.selected]];
    use(it.id);
    const fx=-Math.sin(player.yaw),fz=-Math.cos(player.yaw);
    const x=player.x+fx*.33,z=player.z+fz*.33;
    Object.assign(it,{x:nav.blocked(x,z,.08)?player.x:x,z:nav.blocked(x,z,.08)?player.z:z,
      y:player.eye-.22,available:true,flying:true});
    state.flying.push({index:it.index,vx:fx*2.05,vz:fz*2.05,vy:.5,impact:false});
    issue(it.name+' dropped');
  }
  function updateDrops() {
    state.flying=state.flying.filter(f=>{
      const it=objects[f.index],x=it.x,z=it.z;
      f.vy-=9.81*TICK;nav.move(it,f.vx*TICK,f.vz*TICK,.08);
      if(Math.abs(x-it.x)<.001)f.vx*=-.28;
      if(Math.abs(z-it.z)<.001)f.vz*=-.28;
      it.y+=f.vy*TICK;
      const floor=floorY(it.x,it.z)+.075;
      if(it.y<=floor) {
        it.y=floor;
        if(!f.impact){emit('drop',it,12);f.impact=true;}
        f.vy*=-.27;f.vx*=.51;f.vz*=.51;
        if(f.vy<.48)it.flying=false;
      }
      return it.flying;
    });
  }

  function prompt(o=target()) {
    if(hidden())return player.hideExit?'Leaving cover…':'Leave hiding place';
    if(!o)return '';
    if(o.kind==='item')return 'Take '+o.name;
    if(o.kind==='door')return o.secret?(o.open?'Close bookcase':'Pull bookcase'):(o.open?'Close door':'Open door');
    if(o.kind==='hide')return o.type==='bed'?'Slide under the bed':o.type==='furniture'?'Hide behind the sofa':'Hide in '+o.name.toLowerCase();
    if(o.kind==='drawer'||o.kind==='cabinet')return (o.open?'Close ':'Search ')+o.name.toLowerCase();
    if(o.kind==='note')return 'Read '+o.name.toLowerCase();
    const p=state.progress;
    if(o.kind==='front')return !p.cut?'Inspect chain':!p.unlock?'Inspect lock':'Leave through the front door';
    if(o.kind==='fusebox')return p.power?'Power restored':'Inspect fuse box';
    if(o.kind==='hatch')return p.handle?'Escape through the drain':p.power?'Inspect gate winch':'Inspect drain gate';
    return o.name;
  }

  function target() {
    if(hidden())return null;
    const {yaw,pitch,eye,x,z}=player;
    const fx=-Math.sin(yaw)*Math.cos(pitch), fy=Math.sin(pitch), fz=-Math.cos(yaw)*Math.cos(pitch);
    let best=null,value=-Infinity;
    for(const o of objects) {
      if(o.kind==='item'&&(!o.available||o.flying||(o.container!==null&&!objects[o.container].open)))continue;
      const door=o.kind==='door'||o.kind==='front';
      const dx=o.x-x,dz=o.z-z,range=Math.hypot(dx,dz);
      if(range>(door?2.45:2.27))continue;
      const dy=(door?clamp(eye+fy*range,o.y-.84,o.y+.98):o.y)-eye;
      const distance=Math.hypot(dx,dy,dz);
      if(distance>(door?2.45:2.27))continue;
      const dot=(dx*fx+dy*fy+dz*fz)/(distance||1);
      if(dot<(door?.72:.82))continue;
      const near=Math.max(0,range-(o.kind==='item'||o.kind==='note'?.51:.24))/(range||1);
      if(!nav.clear(x,z,x+dx*near,z+dz*near))continue;
      const score=dot*2.9-distance*.14+(o.kind==='item'?.31:0);
      if(score>value){value=score;best=o;}
    }
    return best;
  }

  function exitPoint(spot) {
    const at=state.hiddenFrom;
    if(at&&!nav.blocked(at.x,at.z))return {x:at.x,z:at.z};
    const [x,z]=spot.exit;
    return nav.blocked(x,z)?null:{x,z};
  }
  function finishHideExit(spot) {
    const at=exitPoint(spot);
    delete player.hideExit;delete player.hideLeave;
    if(!at) {
      if(spot.panels)setContainer(spot,false);
      return issue('The opening is blocked.');
    }
    Object.assign(player,at,{hidden:null,crouch:spot.type!=='wardrobe'});
    player.eye=floorY(at.x,at.z)+(player.crouch?1.03:1.66);
    state.hiddenFrom=null;
    emit('door',player,3.1);
  }
  function interact() {
    if(hidden()) {
      const o=hidden();
      if(safeHiding) {
        const at=exitPoint(o);
        if(!at)return issue('The opening is blocked.');
        player.hideExit=HIDE_EXIT_TICKS;player.hideLeave=at;
        if(o.panels)setContainer(o,true);
        return;
      }
      Object.assign(player,state.hiddenFrom,{hidden:null,crouch:o.type==='bed'});
      state.hiddenFrom=null;
      if(o.panels)setContainer(o,true);
      emit('door',o,3.1);return;
    }
    const o=target(),p=state.progress;
    if(!o)return;
    if(o.kind==='door') {
      if(party?.locked(o.index))return issue('The Caretaker bolted this door.');
      toggleDoor(o,!o.open);
      if(o.secret&&o.open)issue('A passage opens behind the shelves.');
    }
    if(o.kind==='hide') {
      if(party?.hiding(o.index))return issue('Someone is already hiding here.');
      state.hiddenFrom={x:player.x,z:player.z,yaw:player.yaw,pitch:player.pitch};
      Object.assign(player,{hidden:o.index,x:o.anchor[0],z:o.anchor[1],yaw:Math.PI+o.yaw,pitch:o.type==='bed'?.016:-.06});
      if(o.panels)setContainer(o,false);
      if(safeHiding) {
        player.yaw=hideHeading(o);player.eye=o.view[1];
      } else emit('door',o,2.35);
    }
    if(o.kind==='drawer'||o.kind==='cabinet'){setContainer(o,!o.open);emit('door',o,4.2);}
    if(o.kind==='item') {
      if(state.inventory.length===4)return issue('Your hands are full.');
      Object.assign(o,{available:false,container:null,flying:false});
      state.inventory.push(o.index);state.selected=state.inventory.length-1;
      issue(o.name+' collected');emit('item',o,2);
    }
    if(o.kind==='note')notify('note',o);
    if(o.kind==='front') {
      if(!p.cut) {
        if(!use('cutters'))return issue('A steel chain. Find the bolt cutters.');
        p.cut=true;emit('drop',o,10.5);issue('Chain severed. The brass lock is still engaged.');
      }else if(!p.unlock) {
        if(!use('key'))return issue('The brass lock needs a key.');
        p.unlock=true;toggleDoor(o,true);issue('The front door is open. Go.');
      }else win('front');
    }
    if(o.kind==='fusebox') {
      if(p.power)return issue('The drain gate has power.');
      if(!use('fuse'))return issue('The porcelain fuse is missing.');
      p.power=true;emit('power',o,8);issue('Power restored. Find the drain gate.');
    }
    if(o.kind==='hatch') {
      if(!p.power)return issue('No power. Check the fuse box.');
      if(!p.handle) {
        if(!use('crank'))return issue('The winch handle is missing.');
        p.handle=true;solid[blueprint.gate].enabled=false;emit('door',o,9);issue('The drain gate is open. Go.');
      }else win('drain');
    }
  }

  // Input is [held keys, look yaw in milliradians, look pitch, actions, slot].
  function control([keys,yaw,pitch,actions,slot]) {
    player.yaw=Math.atan2(Math.sin(player.yaw+yaw/1000),Math.cos(player.yaw+yaw/1000));
    player.pitch=clamp(player.pitch+pitch/1000,-1.43,1.43);
    if(safeHiding&&hidden()) {
      limitHideLook(player,hidden());
      if(player.hideExit) {
        if(--player.hideExit===0)finishHideExit(hidden());
        return {travelled:0,sprint:false};
      }
    }
    if(slot>=0)state.selected=slot;
    if(actions&action.crouch&&!hidden())player.crouch=!player.crouch;
    if(actions&action.light){state.flash=!state.flash;if(!safeHiding||!hidden())emit('item',player,1.8);}
    if(actions&action.use)interact();
    if(state.mode!=='play')return;
    if(actions&action.drop)drop();
    const {travelled,sprint}=moveSurvivor(player,state,nav,keys);
    if(travelled>TICK*.25) {
      state.step-=TICK;
      if(state.step<=0) {
        state.step=sprint?.31:player.crouch?.71:.49;
        emit('step',player,sprint?10.5:player.crouch?1.55:4.8);
      }
    }
    player.eye=interval(player.eye,safeHiding&&hidden()?hidden().view[1]:
      floorY(player.x,player.z)+(hidden()?(hidden().type==='bed'?.33:1.44):player.crouch?1.03:1.66));
    return {travelled,sprint};
  }

  function tick(input) {
    if(state.mode==='defeat'||state.mode==='victory')return;
    if(state.mode==='interlude') {
      if(!(input[3]&action.wake))return;
      state.day++;startNight();return;
    }
    state.tick++;
    const movement=control(input);
    if(state.mode!=='play')return;
    updateDrops();
    enemy.update(TICK,safeHiding&&hidden()?null:{...player,hidden:hidden()});
    return movement;
  }

  function controlSeat(seat,input) {
    player=seat.body;
    for(const field of seatFields)state[field]=seat[field];
    try {return control(input);}
    finally {
      for(const field of seatFields)seat[field]=state[field];
      player=state.player;
    }
  }

  function tickHouse(candidates) {
    state.tick++;
    updateDrops();
    if(!candidates)return;
    const target=enemy.chooseTarget(candidates);
    if(!target&&!safeHiding)return;
    if(target)party.target(target);
    enemy.update(TICK,target);
    // Co-op captures immobilize one survivor while the others stay in play.
    if(state.brain.state==='attack'&&state.brain.recovering===undefined)enemy.recover();
  }

  function snapshot() {
    return {...state,objects:objects.flatMap(o=>{
      if(o.kind==='item')return [[o.index,{x:o.x,y:o.y,z:o.z,container:o.container,available:o.available,flying:o.flying}]];
      if(o.blocker||o.kind==='drawer'||o.panels)return [[o.index,{open:Boolean(o.open),swing:o.swing}]];
      return [];
    })};
  }
  return {state,world,nav,tick,target,prompt,snapshot,controlSeat,tickHouse,toggleDoor,restoreWorld};
}

export function moveSurvivor(player,state,nav,keys) {
  const moveX=Number(Boolean(keys&key.right))-Number(Boolean(keys&key.left));
  const moveZ=Number(Boolean(keys&key.forward))-Number(Boolean(keys&key.back));
  const moving=player.hidden===null&&Boolean(moveX||moveZ);
  const sprint=moving&&!player.crouch&&!state.tired&&moveZ>=0&&Boolean(keys&key.sprint);
  state.stamina=clamp(state.stamina+(sprint?-.23:.155)*TICK,0,1);
  if(state.stamina===0)state.tired=true;
  if(state.stamina>.36)state.tired=false;
  let travelled=0;
  if(moving) {
    const len=Math.hypot(moveX,moveZ), speed=sprint?4.21:player.crouch?1.21:2.32;
    const oldX=player.x,oldZ=player.z;
    nav.move(player,(moveX*Math.cos(player.yaw)-moveZ*Math.sin(player.yaw))*speed*TICK/len,
      (-moveX*Math.sin(player.yaw)-moveZ*Math.cos(player.yaw))*speed*TICK/len);
    travelled=Math.hypot(player.x-oldX,player.z-oldZ);
  }
  return {travelled,sprint};
}
