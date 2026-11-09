import * as T from '../vendor/three.module.js';
import { createWorld } from './world.js';
import { createCaretaker } from './caretaker.js';
import { floorY, areaAt, TICK } from './rules.js';
import { createSimulation, key, action } from './simulation.js';
import { createAudio } from './audio.js';
import { rng } from './materials.js';

const clamp=T.MathUtils.clamp;
const damp=T.MathUtils.damp;
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
export const chapters=['The Awakening','Something at the Door','The House Listens','No Way Back','The Last Night'];

export function createGame(canvas,ui,settings) {
  const renderer=new T.WebGLRenderer({canvas,antialias:true,powerPreference:'high-performance'});
  renderer.outputColorSpace=T.SRGBColorSpace;
  renderer.toneMapping=T.ACESFilmicToneMapping;renderer.toneMappingExposure=1.24;
  renderer.shadowMap.type=T.PCFShadowMap;
  const scene=new T.Scene();
  scene.background=new T.Color(0x0e1515);
  scene.fog=new T.FogExp2(0x11191a,.051);
  const camera=new T.PerspectiveCamera(69,1,.038,48);
  camera.rotation.order='YXZ';
  scene.add(camera);
  const ambient=new T.HemisphereLight(0xadc7c7,0x5a3828,.76);scene.add(ambient);
  scene.add(new T.AmbientLight(0xd2d0bc,.12));
  const flashlight=new T.SpotLight(0xffe3bb,47,25,Math.PI*.255,.68,1.6);
  flashlight.position.set(.14,-.15,.02);flashlight.target.position.set(.02,.015,-6);
  camera.add(flashlight,flashlight.target);
  flashlight.castShadow=true;
  flashlight.shadow.mapSize.set(768,768);flashlight.shadow.bias=-.00017;flashlight.shadow.normalBias=.028;
  flashlight.shadow.camera.near=.06;flashlight.shadow.camera.far=23;
  const fill=new T.PointLight(0xd5bea4,1.2,4,1.65);fill.position.set(-.08,-.19,-.29);camera.add(fill);
  const lampPool=Array.from({length:5},()=>{const l=new T.PointLight(0xffffff,0,8,1.75);scene.add(l);return l;});
  const dustData=[];
  const rand=rng(711);
  for(let i=0;i<900;i++)dustData.push(-14+rand()*28,.11+rand()*3.15,-13+rand()*26);
  const dustGeo=new T.BufferGeometry();
  dustGeo.setAttribute('position',new T.Float32BufferAttribute(dustData,3));
  const dustTex=Object.assign(document.createElement('canvas'),{width:32,height:32});
  const dustCanvas=dustTex.getContext('2d');
  const grain=dustCanvas.createRadialGradient(16,16,0,16,16,16);
  grain.addColorStop(0,'#fff');grain.addColorStop(.32,'#ddd3bd80');grain.addColorStop(1,'transparent');
  dustCanvas.fillStyle=grain;dustCanvas.fillRect(0,0,32,32);
  const dust=new T.Points(dustGeo,new T.PointsMaterial({color:0xc3b8a0,map:new T.CanvasTexture(dustTex),size:.042,transparent:true,opacity:.32,depthWrite:false,blending:T.AdditiveBlending}));
  scene.add(dust);
  const world=createWorld(scene),audio=createAudio();
  const rig=createCaretaker();scene.add(rig.root);
  const held=new Set();
  let sim,ranked,mode='menu',difficulty=settings.difficulty,dragging=false,touchLook=null,aimAssist=0;
  let pending=0,slot=-1,lookX=0,lookY=0,bob=0,bobStrength=0,time=0,accumulator=0,randomSound=8,lastFrame=0,raf;
  let scareTime=0,scareStart=0,attacker=null,transition=0,cameraYaw=0,cameraPitch=0,eye=1.66;
  let renderWidth=0,renderHeight=0,renderDpr=0,previousArea='',lastLightPos=[Infinity,Infinity],activeLights=[];
  let quality=settings.graphics,hudTick=0;

  function configure() {
    audio.setVolume(settings.volume);
    quality=settings.graphics;
    renderer.shadowMap.enabled=quality==='high';
    flashlight.castShadow=quality==='high';
    dust.visible=quality!=='low';
    resize();
  }
  function resize() {
    const w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;
    const dpr=quality==='low'?.72:quality==='high'?Math.min(devicePixelRatio,1.65):Math.min(devicePixelRatio,1.15);
    if(w===renderWidth&&h===renderHeight&&renderDpr===dpr)return;
    renderWidth=w;renderHeight=h;renderDpr=dpr;
    renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.updateProjectionMatrix();
  }
  function clearInput(){held.clear();dragging=false;touchLook=null;pending=0;slot=-1;lookX=0;lookY=0;accumulator=0;}
  function begin(attempt=null) {
    audio.init();ranked=attempt;difficulty=attempt?.difficulty??settings.difficulty;
    transition++;time=0;
    for(const d of world.doors){d.angle=0;d.pivot.rotation.y=0;}
    world.openGate(false);
    sim=createSimulation(attempt?.seed??crypto.getRandomValues(new Uint32Array(1))[0],difficulty,null,event);
    startNight();
  }
  function startNight() {
    attacker=null;randomSound=8;bob=0;bobStrength=0;previousArea='';clearInput();
    mode='play';audio.enable(true);
    ui.show('play');ui.night(sim.state.day,chapters[sim.state.day-1]);
    syncWorld(0);syncHUD();updateCamera(0);
    startFrames();lock();
  }
  function event(kind,data) {
    if(kind==='sound')audio.play(data.kind,data.at);
    if(kind==='toast')ui.toast(data);
    if(kind==='note')pause('note',data);
    if(kind==='caught')caught(data);
  }
  function lock() {
    if(matchMedia('(pointer: coarse)').matches)return;
    if(document.pointerLockElement===canvas||!canvas.requestPointerLock)return;
    try {
      const p=canvas.requestPointerLock();
      p?.catch(()=>{if(mode==='play')ui.mouseHint(true);});
    }catch{ui.mouseHint(true);}
  }
  function release(){if(document.pointerLockElement===canvas)document.exitPointerLock();}
  function pause(screen='pause',data=null) {
    if(mode!=='play')return;
    mode=screen;release();clearInput();audio.enable(false);ui.show(screen,data);
  }
  function resume() {
    if(!['pause','journal','note','controls'].includes(mode))return;
    mode='play';ui.show('play');audio.init();audio.enable(true);startFrames();lock();
  }
  function menu(){
    transition++;mode='menu';release();clearInput();audio.enable(false);
    ranked?.cancel();ranked=null;ui.show('menu');
  }
  function finish(mode,data) {
    release();clearInput();audio.enable(false);ui.show(mode,{...data,ranked:Boolean(ranked)});
    if(ranked) {
      ranked.finish().then(info=>ui.rankResult(info)).catch(error=>ui.rankResult(null,error.message));
      ranked=null;
    }
  }
  async function caught(position) {
    if(mode!=='play')return;
    const token=++transition;
    attacker={x:position.x,z:position.z};
    scareTime=settings.motion?1.17:.74;scareStart=time;
    mode='caught';release();clearInput();ui.show('caught');
    await wait(scareTime*1000);
    if(mode!=='caught'||token!==transition)return;
    mode=sim.state.mode;
    if(mode==='defeat')finish(mode,{day:sim.state.day});
    else {audio.enable(false);ui.show(mode,{day:sim.state.day});}
  }
  function applyInput(input) {
    ranked?.record(input);
    sim.tick(input);
    if(sim.state.mode==='victory'&&mode==='play') {
      mode='victory';finish(mode,{route:sim.state.route,day:sim.state.day});
    }
  }
  function nextNight() {
    if(mode!=='interlude')return;
    applyInput([0,0,0,action.wake,-1]);startNight();
  }
  const actionKeys={KeyE:action.use,KeyG:action.drop,KeyC:action.crouch,ControlLeft:action.crouch,ControlRight:action.crouch,KeyF:action.light};
  document.addEventListener('keydown',e=>{
    if(mode!=='play')return;
    if(['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
    held.add(e.code);
    if(e.repeat)return;
    if(e.code==='Escape'||e.code==='KeyP')pause();
    if(e.code==='Tab')pause('journal');
    if(actionKeys[e.code])pending|=actionKeys[e.code];
    if(/^Digit[1-4]$/.test(e.code))slot=Number(e.code.at(-1))-1;
  });
  document.addEventListener('keyup',e=>held.delete(e.code));
  document.addEventListener('visibilitychange',()=>{if(document.hidden)pause();else if(mode==='caught')startFrames();});
  window.addEventListener('blur',()=>pause());
  document.addEventListener('pointerlockchange',()=>{
    if(document.pointerLockElement===canvas){aimAssist=.16;ui.mouseHint(false);}
    else if(mode==='play'&&aimAssist<=0)pause();
  });
  document.addEventListener('pointerlockerror',()=>{if(mode==='play')ui.mouseHint(true);});
  function look(x,y){lookX-=x*settings.sensitivity*2.5;lookY-=y*settings.sensitivity*2.5;}
  document.addEventListener('mousemove',e=>{
    if(mode==='play'&&(document.pointerLockElement===canvas||dragging))look(e.movementX,e.movementY);
  });
  canvas.addEventListener('pointerdown',e=>{
    if(mode!=='play')return;
    if(e.pointerType==='touch'){touchLook={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);}
    else {dragging=true;lock();}
  });
  canvas.addEventListener('pointermove',e=>{
    if(mode!=='play'||touchLook?.id!==e.pointerId)return;
    look(e.clientX-touchLook.x,e.clientY-touchLook.y);touchLook.x=e.clientX;touchLook.y=e.clientY;
  });
  window.addEventListener('pointerup',e=>{dragging=false;if(touchLook?.id===e.pointerId)touchLook=null;});
  window.addEventListener('pointercancel',e=>{if(touchLook?.id===e.pointerId)touchLook=null;});
  window.addEventListener('resize',resize);
  for(const b of document.querySelectorAll('[data-touch]')) {
    b.addEventListener('pointerdown',e=>{
      e.preventDefault();if(mode!=='play')return;
      b.setPointerCapture(e.pointerId);
      const k=b.dataset.touch;
      if(actionKeys[k])pending|=actionKeys[k];
      else if(k==='pause')pause();
      else if(k==='journal')pause('journal');
      else held.add(k);
    });
    const up=()=>held.delete(b.dataset.touch);
    b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
  }

  for(const button of document.querySelectorAll('[data-slot]'))button.addEventListener('pointerdown',event=>{
    if(mode==='play'&&event.pointerType==='touch'){event.preventDefault();slot=Number(button.dataset.slot);}
  });
  function input() {
    let keys=0;
    if(held.has('KeyW')||held.has('ArrowUp'))keys|=key.forward;
    if(held.has('KeyS')||held.has('ArrowDown'))keys|=key.back;
    if(held.has('KeyA'))keys|=key.left;
    if(held.has('KeyD'))keys|=key.right;
    if(held.has('ShiftLeft')||held.has('ShiftRight'))keys|=key.sprint;
    if(held.has('ArrowLeft'))lookX+=TICK*1750;
    if(held.has('ArrowRight'))lookX-=TICK*1750;
    const x=clamp(Math.trunc(lookX),-3200,3200),y=clamp(Math.trunc(lookY),-2860,2860);
    const next=[keys,x,y,pending,slot];
    lookX-=x;lookY-=y;pending=0;slot=-1;
    return next;
  }
  function syncHUD(sprint=false) {
    const s=sim.state,p=s.player;
    ui.updateInventory(s.inventory.map(i=>sim.world.objects[i]),s.selected);
    ui.updateObjectives(s.progress);ui.stamina(s.stamina,sprint);ui.flash(s.flash);
    ui.hide(p.hidden!==null);
  }
  function syncWorld(dt) {
    const s=sim.state;
    for(let i=0;i<world.objects.length;i++) {
      const model=world.objects[i],o=sim.world.objects[i];
      if(model.kind==='item') {
        model.mesh.visible=o.available&&(o.container===null||Boolean(sim.world.objects[o.container].open));
        model.mesh.position.set(o.x,o.y,o.z);
        if(o.flying){model.mesh.rotation.x+=dt*5;model.mesh.rotation.z+=dt*2.8;}
        else model.mesh.rotation.set(0,.4,0);
      }else if(model.pivot) {
        model.angle=damp(model.angle,o.open?o.swing??1.71:0,8.5,dt);
        model.pivot.rotation.y=model.angle;
        if(model.chain)model.chain.visible=!s.progress.cut;
      }else if((model.drawer||model.panels)&&Boolean(model.open)!==Boolean(o.open))world.setContainer(model,o.open);
    }
    world.power(s.progress.power);world.openGate(s.progress.handle);world.updateGate(dt);
    const brain=s.brain,a=brain.actor;
    rig.root.position.set(a.x,floorY(a.x,a.z),a.z);
    rig.root.rotation.y+=Math.atan2(Math.sin(brain.heading-rig.root.rotation.y),Math.cos(brain.heading-rig.root.rotation.y))*Math.min(1,dt*17);
    rig.animate(dt,time,mode==='caught'?0:brain.pace,brain.state,brain.gaze);
  }
  function updateCamera(dt) {
    const p=sim.state.player;
    const bobbing=settings.motion?Math.sin(bob)*bobStrength:0;
    eye=dt?damp(eye,p.eye+bobbing,17,dt):p.eye;
    camera.position.set(p.x,eye,p.z);
    if(mode!=='caught'){cameraYaw=p.yaw;cameraPitch=p.pitch;}
    let tilt=settings.motion?Math.cos(bob*.5)*bobStrength*.44:0;
    if(mode==='caught'&&attacker) {
      const t=clamp((time-scareStart)/scareTime,0,1),x=attacker.x-p.x,z=attacker.z-p.z;
      const d=Math.max(.34,Math.hypot(x,z)),angle=Math.atan2(-x,-z);
      cameraYaw+=Math.atan2(Math.sin(angle-cameraYaw),Math.cos(angle-cameraYaw))*Math.min(1,dt*21);
      cameraPitch=damp(cameraPitch,Math.atan2(floorY(attacker.x,attacker.z)+1.62-eye,d),15,dt);
      tilt=settings.motion?Math.sin(t*62)*.065*(1-t):0;
      camera.position.x+=x/d*t*.18+tilt;camera.position.z+=z/d*t*.18+tilt*.54;
    }
    camera.rotation.set(cameraPitch,cameraYaw,tilt,'YXZ');
  }
  function updateLighting(dt) {
    const player=sim.state.player,nav=sim.nav;
    if(Math.hypot(player.x-lastLightPos[0],player.z-lastLightPos[1])>1.3) {
      lastLightPos=[player.x,player.z];
      const dist=l=>Math.hypot(l.x-player.x,l.z-player.z)+(nav.clear(l.x,l.z,player.x,player.z)?0:3.2);
      activeLights=[...world.lights].sort((a,b)=>dist(a)-dist(b)).slice(0,lampPool.length);
    }
    for(let i=0;i<lampPool.length;i++) {
      const src=activeLights[i],l=lampPool[i];if(!src)continue;
      l.position.set(src.x,src.y,src.z);l.color.setHex(src.color);
      const flicker=settings.motion&&src.flicker?1-Math.pow(Math.max(0,Math.sin(time*4+src.flicker)*Math.cos(time*15+src.flicker)),7)*.55:1;
      const spill=nav.clear(src.x,src.z,player.x,player.z)?1:.21;
      l.intensity=damp(l.intensity,src.power*flicker*spill,8,dt);
    }
    const a=sim.state.brain.actor,dx=a.x-player.x,dz=a.z-player.z,distance=Math.hypot(dx,dz);
    const facing=(-Math.sin(cameraYaw)*dx-Math.cos(cameraYaw)*dz)/(distance||1);
    const close=distance<3&&facing>.66&&nav.clear(player.x,player.z,a.x,a.z);
    const beam=close?clamp(.047+.095*distance*distance,.105,1):1;
    flashlight.intensity=damp(flashlight.intensity,(sim.state.flash&&player.hidden===null?48:mode==='caught'?31:0)*beam,17,dt);
    fill.intensity=player.hidden!==null?.26:1.25;
    dust.position.y=Math.sin(time*.47)*.21;
  }
  function startFrames(){if(!raf){lastFrame=performance.now();raf=requestAnimationFrame(frame);}}
  let lastProgress='',lastInventory='';
  function frame(now) {
    raf=0;
    if(!['play','caught'].includes(mode))return;
    const dt=clamp((now-lastFrame)/1000,0,.10);
    lastFrame=now;time+=dt;aimAssist-=dt;resize();
    if(mode==='play') {
      accumulator+=dt;
      let moving=false,sprint=false;
      while(accumulator>=TICK&&mode==='play') {
        accumulator-=TICK;
        const before={x:sim.state.player.x,z:sim.state.player.z};
        applyInput(input());
        moving ||= Math.hypot(sim.state.player.x-before.x,sim.state.player.z-before.z)>TICK*.25;
      }
      const s=sim.state,p=s.player;
      if(mode==='play') {
        const a=s.brain.actor,tension=clamp(1-Math.hypot(p.x-a.x,p.z-a.z)/9.5,0,1);
        sprint=moving&&!s.tired&&!p.crouch&&(held.has('ShiftLeft')||held.has('ShiftRight'));
        if(moving)bob+=dt*(sprint?13.7:p.crouch?6.1:9.9);
        bobStrength=damp(bobStrength,moving?(sprint?.039:p.crouch?.013:.021):0,14,dt);
        audio.update(dt,p,p.yaw,tension,sprint);
        ui.threat(s.brain.state,tension);ui.stamina(s.stamina,sprint);ui.hide(p.hidden!==null);ui.flash(s.flash);
        const progress=JSON.stringify(s.progress),inventory=s.inventory.join(',')+':'+s.selected;
        if(progress!==lastProgress){lastProgress=progress;ui.updateObjectives(s.progress);}
        if(inventory!==lastInventory){lastInventory=inventory;ui.updateInventory(s.inventory.map(i=>sim.world.objects[i]),s.selected);}
        if((randomSound-=dt)<=0) {
          randomSound=11+Math.random()*18;
          audio.play(Math.random()<.63?'whisper':'door',{x:p.x-4+Math.random()*8,z:p.z-3+Math.random()*6});
        }
        const area=areaAt(p.x,p.z);
        if(area!==previousArea){previousArea=area;ui.area(area);}
        if((hudTick-=dt)<=0){hudTick=.052;ui.prompt(sim.prompt());}
      }
    }
    syncWorld(dt);updateCamera(dt);updateLighting(dt);
    renderer.render(scene,camera);
    if(['play','caught'].includes(mode))raf=requestAnimationFrame(frame);
  }
  configure();
  return {begin,resume,menu,pause,nextNight,configure,get mode(){return mode;}};
}
