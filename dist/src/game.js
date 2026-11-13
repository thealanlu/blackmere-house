import * as T from '../vendor/three.module.js';
import { createWorld } from './world.js';
import { createCaretaker } from './caretaker.js';
import { floorY, areaAt, smoothstep, TICK, hasMap, floorAt } from './rules.js';
import { CHECKPOINT_VERSION } from './checkpoint.js';
import { createSimulation, moveSurvivor, key, action } from './simulation.js';
import { createAudio } from './audio.js';
import { rng,setMaterialQuality } from './materials.js';
import { moveGranny, skill } from './match.js';
import { survivorModel } from './survivor.js';
import { mansionMap } from './minimap.js';
import { HIDE_EXIT_TICKS,limitHideLook } from './hide-view.js';
import { adaptiveResolution,pixelRatio,presets,recommendedPreset } from './performance.js';
import { aimAxis,bindJoystick,gyroControl,movementBits,padButtons,supportedPad } from './input.js';

const clamp=T.MathUtils.clamp;
const damp=T.MathUtils.damp;
const wait=(ms)=>new Promise(resolve=>setTimeout(resolve,ms));
const soundLabels={door:'Door creak',drop:'Impact',power:'Power surge',whisper:'Whisper',settle:'House creak'};
export const chapters=['The Awakening','Something at the Door','The House Listens','No Way Back','The Last Night'];

export function createGame(canvas,ui,settings,audio=createAudio()) {
  const mobile=matchMedia('(any-pointer: coarse)').matches;
  const renderer=new T.WebGLRenderer({canvas,antialias:false,powerPreference:mobile?'default':'high-performance'});
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
  const remoteBeams=Array.from({length:3},()=>{
    const light=new T.SpotLight(0xffe3bb,0,16,Math.PI*.22,.72,1.65);
    scene.add(light,light.target);return light;
  });
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
  const world=createWorld(scene);
  const mapTemplate=document.querySelector('#mapTemplate'),mapMount=document.querySelector('#mapMount');
  let map=null;
  function setupMap(enabled) {
    map=null;mapMount.replaceChildren();
    if(!enabled)return;
    mapMount.append(mapTemplate.content.cloneNode(true));
    const get=id=>mapMount.querySelector('#'+id);
    map=mansionMap({canvas:get('mansionMap'),floorLabel:get('mapFloor'),button:get('mapSwitch'),notice:get('mapNotice')},settings);
  }
  const rig=createCaretaker();scene.add(rig.root);
  const remotes=new Map(),traps=new T.Group();
  const snareGeo=new T.TorusGeometry(.19,.019,6,20),snareMat=new T.MeshStandardMaterial({color:0x745344,metalness:.64,roughness:.71});
  scene.add(traps);
  const held=new Set();
  let sim,ranked,mode='menu',difficulty=settings.difficulty,dragging=false,touchLook=null,aimAssist=0;
  let pending=0,slot=-1,lookX=0,lookY=0,bob=0,bobStrength=0,time=0,accumulator=0,randomSound=8,lastFrame=0,raf;
  let scareTime=0,scareStart=0,attacker=null,transition=0,cameraYaw=0,cameraPitch=0,eye=1.66;
  let renderWidth=0,renderHeight=0,renderDpr=0,previousArea='',lastLightPos=[Infinity,Infinity],activeLights=[];
  const scaling=adaptiveResolution();
  const recommended=recommendedPreset({coarse:mobile,memory:navigator.deviceMemory,cores:navigator.hardwareConcurrency,
    texture:renderer.capabilities.maxTextureSize});
  let quality,frameTarget=1000/60,nextFrame=0,hudTick=0;
  let online,netState,netKeys=0,netClock=0,netFrame=0,trapSignature='';
  let solo=false,nextSave=0;
  let lastCover=null,hideEntry=null;
  const joystick=bindJoystick(document.querySelector('#joystick'),document.querySelector('#joystickThumb'),()=>ui.control('touch'));
  const gyro=gyroControl((x,y)=>look(x,y,settings.touchSensitivity),()=>mode==='play'&&settings.gyro&&ui.controlKind()==='touch');
  let pad,padHeld=[],lastKeys=0;

  function configure() {
    audio.setVolume(settings.volume);
    audio.setMusic(settings.music);
    const next=presets[settings.graphics==='auto'?recommended:settings.graphics];
    const target=1000/(settings.frameRate==='auto'?next.fps:Number(settings.frameRate));
    if(next!==quality||target!==frameTarget)scaling.reset();
    if(next!==quality) {
      quality=next;
      renderer.shadowMap.enabled=Boolean(quality.shadow);
      flashlight.castShadow=Boolean(quality.shadow);
      flashlight.shadow.map?.dispose();flashlight.shadow.map=null;
      if(quality.shadow) {
        flashlight.shadow.mapSize.setScalar(quality.shadow);
      }
      dust.visible=quality.particles>0;dustGeo.setDrawRange(0,quality.particles);
      for(const [i,lamp] of lampPool.entries())lamp.visible=i<quality.lamps;
      lastLightPos=[Infinity,Infinity];setMaterialQuality(quality.texture);
      rig.detail(quality===presets.low);
      for(const model of remotes.values())model.detail(quality===presets.low);
    }
    if(!settings.adaptive)scaling.reset();
    frameTarget=target;renderer.toneMappingExposure=1.24*settings.brightness;
    canvas.dataset.graphics=Object.keys(presets).find(key=>presets[key]===quality);
    canvas.dataset.frameCap=String(Math.round(1000/frameTarget));
    resize();
  }
  function resize() {
    const w=canvas.clientWidth||window.innerWidth,h=canvas.clientHeight||window.innerHeight;
    const dpr=Math.round(pixelRatio(quality,w,h,devicePixelRatio,scaling.scale)*100)/100;
    if(w===renderWidth&&h===renderHeight&&renderDpr===dpr)return;
    renderWidth=w;renderHeight=h;renderDpr=dpr;
    renderer.setPixelRatio(dpr);renderer.setSize(w,h,false);
    camera.aspect=w/h;camera.fov=w<h?Math.min(87,69+(1-w/h)*28):69;camera.updateProjectionMatrix();
  }
  function clearInput(){held.clear();joystick.reset();gyro.reset();dragging=false;touchLook=null;pending=0;slot=-1;lookX=0;lookY=0;accumulator=0;lastKeys=0;}
  function begin(attempt=null,saved=null) {
    audio.init();ranked=attempt;solo=!attempt;difficulty=attempt?.difficulty??saved?.difficulty??settings.difficulty;
    setupMap(hasMap(difficulty));ui.difficulty(difficulty);
    transition++;time=0;
    for(const d of world.doors){d.angle=0;d.pivot.rotation.y=0;}
    world.openGate(false);
    sim=createSimulation(attempt?.seed??crypto.getRandomValues(new Uint32Array(1))[0],difficulty,
      saved?structuredClone(saved.state):null,event);
    nextSave=12;
    if(sim.state.mode==='interlude') {
      mode='interlude';audio.enable(false);ui.show('interlude',{day:sim.state.day});
    } else startNight();
  }
  function checkpoint() {
    return solo&&sim&&['play','interlude'].includes(sim.state.mode)?
      {version:CHECKPOINT_VERSION,difficulty,state:sim.snapshot()}:null;
  }
  function keepCheckpoint() {
    const value=checkpoint();
    if(value)ui.checkpoint(value);
  }
  function beginMatch(link) {
    audio.init();solo=false;online=link;netState=null;netKeys=0;transition++;time=0;previousArea='';
    setupMap(false);lastCover=null;hideEntry=null;
    clearInput();mode='play';audio.enable(true);ui.show('play');ui.matchConnection('Connecting to the house…');
    link.start(receiveMatch,text=>ui.matchConnection(text));
    lock();
  }
  function receiveMatch(packet,roundtrip) {
    const previous=netState;
    netState=packet;netClock=packet.clock;netFrame=performance.now();
    if(packet.phase==='result') {
      const connection=online;
      endMatch();connection.complete(packet);return;
    }
    const s=packet.me,body=packet.watch?.body??s.body;
    if(!previous) {
      difficulty=packet.difficulty;
      setupMap(hasMap(difficulty));ui.difficulty(difficulty);
      sim=createSimulation(0,difficulty);
      for(const d of world.doors){d.angle=0;d.pivot.rotation.y=0;}
      ui.night(1,packet.mode==='pvp'?'Survivors vs. Granny':'Co-op Escape');
    }
    const state=sim.state,p=state.player;
    state.progress=packet.progress;state.inventory=packet.watch?.inventory??s.inventory;state.selected=s.selected;
    state.flash=packet.watch?.flash??s.flash;state.charge=packet.watch?.charge??s.charge;state.stamina=s.stamina;state.tired=s.tired;
    if(packet.world)sim.restoreWorld(packet.world);
    const snapped=!previous||previous.me.status!==s.status||previous.watch?.name!==packet.watch?.name||p.hidden!==body.hidden||
      Math.hypot(p.x-body.x,p.z-body.z)>1.35;
    if(snapped||s.status!=='active')Object.assign(p,body);
    else {
      const next={...body},energy={stamina:s.stamina,tired:s.tired};
      if(packet.timers.slow<=packet.clock&&(s.role!=='granny'||packet.timers.warm<=packet.clock)) {
        for(let i=0;i<Math.min(3,Math.round(roundtrip/65));i++) {
          if(s.role==='granny')moveGranny(next,sim.nav,netKeys,packet.grannySpeed);
          else moveSurvivor(next,energy,sim.nav,netKeys);
        }
      }
      p.crouch=body.crouch;
      sim.nav.move(p,(next.x-p.x)*.34,(next.z-p.z)*.34,s.role==='granny'?.24:.23);
    }
    if(body.hideExit){p.hideExit=body.hideExit;p.hideLeave=body.hideLeave;}
    else {delete p.hideExit;delete p.hideLeave;}
    if(p.hidden!==null)p.eye=body.eye;
    for(const [door,opened] of packet.doorAlerts??[])map?.alert(door,packet.clock-opened,opened);
    audio.listen(p);
    for(const event of packet.events)playMatchEvent(event);
    if(!previous){syncWorld(0);syncHUD();updateCamera(0);startFrames();}
    ui.match(packet);
  }
  function playMatchEvent(e) {
    if(e.text){ui.toast(e.text);return;}
    const player=sim.state.player;
    if(e.kind==='enemyStep') {
      if(e.source!==netState.me.id)caretakerStep(player,e);
      return;
    }
    if(e.x===undefined||e.source===netState.me.id&&e.kind==='step')return;
    const muffled=!sim.nav.clear(player.x,player.z,e.x,e.z),distance=Math.hypot(e.x-player.x,e.z-player.z);
    if(distance>e.radius*(muffled?.8:1.14))return;
    audio.play(e.kind,{...e,muffled,spatialGain:Math.max(.15,1-distance/(e.radius*1.32))});
    if(netState.me.role==='granny'&&settings.footstepCues&&e.source!==netState.me.id&&
      ['step','drop','door'].includes(e.kind)) {
      ui.footstep(soundDirection(player,e),muffled,e.kind==='step'?'Survivor steps':e.kind==='drop'?'Impact':'Door noise');
    }else if(e.source!==netState.me.id)caption(e.kind,player,e);
  }
  function soundDirection(player,step) {
    const dx=step.x-player.x,dz=step.z-player.z;
    const pan=dx*Math.cos(player.yaw)-dz*Math.sin(player.yaw);
    const front=-dx*Math.sin(player.yaw)-dz*Math.cos(player.yaw);
    return Math.abs(pan)>Math.abs(front)?(pan<0?'left':'right'):(front<0?'behind':'ahead');
  }
  function caption(kind,player,at) {
    if(!settings.footstepCues||!at||!soundLabels[kind]||!hasMap(difficulty)&&kind==='door')return;
    const distance=Math.hypot(at.x-player.x,at.z-player.z);
    if(distance<.35||distance>7)return;
    const muffled=!sim.nav.clear(player.x,player.z,at.x,at.z);
    if(!muffled||distance<4)ui.footstep(soundDirection(player,at),muffled,soundLabels[kind]);
  }
  function startNight() {
    attacker=null;randomSound=8;bob=0;bobStrength=0;previousArea='';clearInput();
    map?.reset();lastCover=null;hideEntry=null;
    mode='play';audio.enable(true);
    ui.show('play');ui.night(sim.state.day,chapters[sim.state.day-1]);
    syncWorld(0);syncHUD();updateCamera(0);
    keepCheckpoint();
    startFrames();lock();
  }
  function event(kind,data) {
    if(kind==='sound') {
      const player=sim.state.player;
      audio.listen(player);
      if(data.kind==='enemyStep')caretakerStep(player,data.at);
      else {audio.play(data.kind,data.at);caption(data.kind,player,data.at);}
    }
    if(kind==='toast'){ui.toast(data);pulse(14);}
    if(kind==='grannyDoor')map?.alert(data.door);
    if(kind==='note')pause('note',data);
    if(kind==='caught')caught(data);
  }
  function caretakerStep(player,step) {
    const dx=step.x-player.x,dz=step.z-player.z,distance=Math.hypot(dx,dz);
    if(distance>=11)return;
    const muffled=player.hidden!==null||!sim.nav.clear(player.x,player.z,step.x,step.z);
    const pan=(dx*Math.cos(player.yaw)-dz*Math.sin(player.yaw))/(distance||1);
    const front=(-dx*Math.sin(player.yaw)-dz*Math.cos(player.yaw))/(distance||1);
    const range=muffled?7:11;
    const gain=Math.max(0,1-distance/range)**1.4*(muffled?.48:1)*(front<-.71?.85:1);
    if(gain<.027)return;
    const stone=['Kitchen','Cellar','Boiler Room'].includes(areaAt(step.x,step.z));
    audio.footstep({...step,pan,gain,muffled,stone});
    if(settings.footstepCues&&hasMap(difficulty)) {
      ui.footstep(soundDirection(player,step),muffled);
    }
  }
  function lock() {
    if(ui.controlKind()!=='mouse')return;
    if(document.pointerLockElement===canvas)return;
    if(!canvas.requestPointerLock){ui.mouseHint(true);return;}
    try {
      const p=canvas.requestPointerLock();
      p?.catch(()=>{if(mode==='play')ui.mouseHint(true);});
    }catch{ui.mouseHint(true);}
  }
  function release(){if(document.pointerLockElement===canvas)document.exitPointerLock();}
  function pause(screen='pause',data=null) {
    if(mode!=='play')return;
    mode=screen;release();clearInput();audio.enable(false);keepCheckpoint();ui.show(screen,data);
    if(online){netKeys=0;online.idle();}
  }
  function resume() {
    if(!['pause','journal','note','controls'].includes(mode))return;
    mode='play';ui.show('play');audio.init();audio.enable(true);startFrames();lock();
  }
  function menu(preserve=false){
    if(online) {
      const connection=online;
      endMatch();connection.leave();return;
    }
    if(solo&&!preserve)ui.checkpoint(null,true);
    solo=false;transition++;mode='menu';release();clearInput();audio.enable(false);
    ranked?.cancel();ranked=null;ui.show('menu');
  }
  function endMatch() {
    online?.stop();online=null;netState=null;netKeys=0;
    for(const model of remotes.values())scene.remove(model.root);
    remotes.clear();traps.clear();trapSignature='';rig.root.visible=true;
    mode='menu';release();clearInput();audio.enable(false);ui.match(null);
  }
  function finish(mode,data) {
    if(solo){solo=false;ui.checkpoint(null,true);}
    release();clearInput();audio.enable(false);ui.show(mode,{...data,ranked:Boolean(ranked)});
    if(ranked) {
      ranked.finish().then(info=>ui.rankResult(info)).catch(error=>ui.rankResult(null,error.message));
      ranked=null;
    }
  }
  async function caught(position) {
    if(mode!=='play')return;
    const token=++transition;
    attacker={x:position.x,z:position.z};pulse([35,28,65]);
    scareTime=settings.motion?1.17:.74;scareStart=time;
    mode='caught';release();clearInput();ui.show('caught');
    await wait(scareTime*1000);
    if(mode!=='caught'||token!==transition)return;
    mode=sim.state.mode;
    if(mode==='defeat')finish(mode,{day:sim.state.day});
    else {audio.enable(false);keepCheckpoint();ui.show(mode,{day:sim.state.day});}
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
  const actionKeys={KeyE:action.use,KeyG:action.drop,KeyC:action.crouch,ControlLeft:action.crouch,ControlRight:action.crouch,KeyF:action.light,KeyR:action.reload};
  const matchKeys={KeyQ:skill.trap,KeyX:skill.bolt};
  function pulse(pattern) {
    if(settings.haptics&&ui.controlKind()==='touch')navigator.vibrate?.(pattern);
  }
  document.addEventListener('keydown',e=>{
    if(mode!=='play')return;
    ui.control('mouse');
    if(['Tab','Space','ArrowUp','ArrowDown','ArrowLeft','ArrowRight','Escape','ControlLeft','ControlRight'].includes(e.code))e.preventDefault();
    held.add(e.code);
    if(e.repeat)return;
    if(e.code==='Escape'||e.code==='KeyP')pause();
    if(e.code==='Tab')pause('journal');
    if(e.code==='KeyM')map?.toggle();
    if(actionKeys[e.code])pending|=actionKeys[e.code];
    if(online&&matchKeys[e.code])pending|=matchKeys[e.code];
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
  function look(x,y,sensitivity=settings.sensitivity) {
    lookX-=x*sensitivity*2.5*(settings.invertX?-1:1);
    lookY-=y*sensitivity*2.5*(settings.invertY?-1:1);
  }
  document.addEventListener('mousemove',e=>{
    if(mode!=='play')return;
    if(document.pointerLockElement===canvas)look(e.movementX||0,e.movementY||0);
    else if(dragging) {
      look(e.clientX-dragging.x,e.clientY-dragging.y);
      dragging={x:e.clientX,y:e.clientY};
    }
  });
  canvas.addEventListener('pointerdown',e=>{
    if(mode!=='play')return;
    if(e.pointerType==='touch'||e.pointerType==='pen'){
      ui.control('touch');
      if(touchLook)return;
      touchLook={id:e.pointerId,x:e.clientX,y:e.clientY};canvas.setPointerCapture(e.pointerId);
    }else {ui.control('mouse');dragging={x:e.clientX,y:e.clientY};lock();}
  });
  canvas.addEventListener('pointermove',e=>{
    if(mode!=='play'||touchLook?.id!==e.pointerId)return;
    look(e.clientX-touchLook.x,e.clientY-touchLook.y,settings.touchSensitivity);touchLook.x=e.clientX;touchLook.y=e.clientY;
  });
  window.addEventListener('pointerup',e=>{dragging=false;if(touchLook?.id===e.pointerId)touchLook=null;});
  window.addEventListener('pointercancel',e=>{if(touchLook?.id===e.pointerId)touchLook=null;});
  window.addEventListener('resize',resize);
  window.visualViewport?.addEventListener('resize',resize);
  window.addEventListener('orientationchange',()=>{joystick.reset();gyro.reset();touchLook=null;});
  function touchAction(k) {
    if(actionKeys[k])pending|=actionKeys[k];
    else if(online&&matchKeys[k])pending|=matchKeys[k];
    else if(k==='pause')pause();
    else if(k==='journal')pause('journal');
    else held.add(k);
    if(actionKeys[k]||matchKeys[k])pulse(10);
  }
  const flashlightButton=document.querySelector('#touchLight');
  let pressLight=0;
  flashlightButton.addEventListener('pointerdown',e=>{
    e.preventDefault();if(mode!=='play')return;
    ui.control('touch');flashlightButton.setPointerCapture(e.pointerId);
    pressLight=performance.now();
  });
  flashlightButton.addEventListener('pointerup',e=>{
    if(pressLight&&mode==='play')touchAction(performance.now()-pressLight>440?'KeyR':'KeyF');
    pressLight=0;
  });
  flashlightButton.addEventListener('pointercancel',()=>{pressLight=0;});
  flashlightButton.addEventListener('click',e=>{if(e.detail===0&&mode==='play')touchAction('KeyF');});
  for(const b of document.querySelectorAll('[data-touch]')) {
    b.addEventListener('pointerdown',e=>{
      e.preventDefault();if(mode!=='play')return;
      ui.control('touch');
      b.setPointerCapture(e.pointerId);
      touchAction(b.dataset.touch);
    });
    b.addEventListener('click',e=>{if(e.detail===0&&mode==='play')touchAction(b.dataset.touch);});
    const up=()=>held.delete(b.dataset.touch);
    b.addEventListener('pointerup',up);b.addEventListener('pointercancel',up);b.addEventListener('lostpointercapture',up);
  }

  for(const button of document.querySelectorAll('[data-slot]'))button.addEventListener('pointerdown',event=>{
    if(mode==='play'&&['touch','pen'].includes(event.pointerType)){event.preventDefault();slot=Number(button.dataset.slot);}
  });
  function samplePad() {
    pad=supportedPad();
    if(!pad){padHeld=[];return;}
    const pressed=pad.buttons.map(b=>b.pressed);
    const edge=i=>pressed[i]&&!padHeld[i];
    if(pressed.some(Boolean)||pad.axes.some(v=>Math.abs(v)>.23))ui.control('pad');
    const p=padButtons;
    if(edge(p.pause)||edge(p.back))pause();
    else if(edge(p.journal))pause('journal');
    if(edge(14))map?.toggle();
    if(edge(p.use))pending|=action.use;
    if(edge(p.crouch))pending|=action.crouch;
    if(edge(p.light))pending|=pressed[p.sprint]?action.reload:action.light;
    if(edge(p.drop))pending|=action.drop;
    if(online&&edge(p.trap))pending|=skill.trap;
    if(online&&edge(p.bolt))pending|=skill.bolt;
    if(edge(p.previous)||edge(p.next))slot=((sim.state.selected??0)+(edge(p.previous)?3:1))%4;
    padHeld=pressed;
  }
  function input() {
    let keys=joystick.keys;
    if(held.has('KeyW')||held.has('ArrowUp'))keys|=key.forward;
    if(held.has('KeyS')||held.has('ArrowDown'))keys|=key.back;
    if(held.has('KeyA'))keys|=key.left;
    if(held.has('KeyD'))keys|=key.right;
    if(held.has('ShiftLeft')||held.has('ShiftRight'))keys|=key.sprint;
    if(held.has('ArrowLeft'))lookX+=TICK*1750;
    if(held.has('ArrowRight'))lookX-=TICK*1750;
    if(pad) {
      const [moveX,moveY,aimX,aimY]=pad.axes;
      keys|=movementBits(moveX??0,moveY??0);
      if(padHeld[padButtons.sprint])keys|=key.sprint;
      look(aimAxis(aimX)*TICK*1010,aimAxis(aimY)*TICK*1010,settings.padSensitivity);
    }
    const x=clamp(Math.trunc(lookX),-3200,3200),y=clamp(Math.trunc(lookY),-2860,2860);
    const next=[keys,x,y,pending,slot];
    lookX-=x;lookY-=y;pending=0;slot=-1;lastKeys=keys;
    return next;
  }
  function syncHUD(sprint=false) {
    const s=sim.state,p=s.player;
    ui.updateInventory(s.inventory.map(i=>sim.world.objects[i]),s.selected);
    ui.updateObjectives(s.progress,difficulty);ui.stamina(s.stamina,sprint);ui.flash(s.flash,s.charge,s.inventory.filter(i=>sim.world.objects[i].id==='battery').length,netState?.me.role==='granny');
    ui.hide(sim.world.objects[p.hidden]?.type);
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
    world.power(s.progress.power);world.openGate(s.progress.handle);world.updateGate(dt);world.updateContainers(dt);
    if(online){syncAvatars(dt);return;}
    for(const beam of remoteBeams)beam.intensity=0;
    const brain=s.brain,a=brain.actor;
    rig.root.position.set(a.x,floorY(a.x,a.z),a.z);
    if(dt)rig.root.rotation.y+=Math.atan2(Math.sin(brain.heading-rig.root.rotation.y),Math.cos(brain.heading-rig.root.rotation.y))*Math.min(1,dt*17);
    else rig.root.rotation.y=brain.heading;
    rig.animate(dt,time,mode==='caught'?0:brain.pace,brain.state,brain.gaze,brain.stride);
  }
  function syncAvatars(dt) {
    const packet=netState;
    if(!packet)return;
    const granny=packet.avatars.find(p=>p.role==='granny');
    const ai=packet.ai;
    rig.root.visible=Boolean(granny||ai);
    if(granny||ai) {
      const a=granny??ai.actor,heading=granny?granny.yaw+Math.PI:ai.heading;
      poseAt(rig.root,a,heading,dt);
      rig.animate(dt,time,granny?.pace??ai.pace,granny?(granny.attack?'attack':'patrol'):ai.state,ai?.gaze??0,granny?.stride??ai.stride);
    }
    const present=new Set();
    let beams=0;
    for(const avatar of packet.avatars) {
      if(avatar.role!=='survivor')continue;
      let model=remotes.get(avatar.id);
      if(!model) {
        model=survivorModel(packet.roster.filter(p=>p.role==='survivor').findIndex(p=>p.id===avatar.id));
        model.detail(quality===presets.low);
        scene.add(model.root);remotes.set(avatar.id,model);
      }
      poseAt(model.root,avatar,avatar.yaw+Math.PI,dt);
      model.pose(avatar,time,dt);present.add(avatar.id);
      if(avatar.flash&&beams<remoteBeams.length) {
        const beam=remoteBeams[beams++],{x,z,yaw,pitch}=avatar;
        model.flashlight.getWorldPosition(beam.position);
        beam.target.position.set(beam.position.x-5*Math.sin(yaw),beam.position.y+5*Math.sin(pitch),beam.position.z-5*Math.cos(yaw));
        beam.distance=sim.nav.beamReach(x,z,yaw,16);
        beam.intensity=32;
      }
    }
    for(let i=beams;i<remoteBeams.length;i++)remoteBeams[i].intensity=0;
    for(const [id,model] of remotes) {
      if(!present.has(id)){scene.remove(model.root);remotes.delete(id);}
    }
    const signature=packet.traps.map(t=>t.x+','+t.z).join('/');
    if(signature!==trapSignature) {
      traps.clear();trapSignature=signature;
      for(const t of packet.traps) {
        const snare=new T.Mesh(snareGeo,snareMat);
        snare.rotation.x=Math.PI/2;snare.position.set(t.x,floorY(t.x,t.z)+.039,t.z);traps.add(snare);
      }
    }
  }
  function poseAt(root,p,heading,dt) {
    const snap=!root.userData.placed||Math.hypot(root.position.x-p.x,root.position.z-p.z)>2.1;
    const x=snap?p.x:damp(root.position.x,p.x,14,dt),z=snap?p.z:damp(root.position.z,p.z,14,dt);
    root.position.set(x,floorY(x,z),z);root.userData.placed=true;
    root.rotation.y=snap?heading:root.rotation.y+Math.atan2(Math.sin(heading-root.rotation.y),Math.cos(heading-root.rotation.y))*Math.min(1,dt*17);
  }
  function matchInput(next) {
    const p=sim.state.player,{me,timers}=netState;
    const canMove=me.status==='active'&&!netState.watch,granny=me.role==='granny';
    netKeys=canMove?next[0]:0;
    if(canMove) {
      p.yaw=Math.atan2(Math.sin(p.yaw+next[1]/1000),Math.cos(p.yaw+next[1]/1000));
      p.pitch=clamp(p.pitch+next[2]/1000,-1.43,1.43);
      if(p.hidden!==null)limitHideLook(p,sim.world.objects[p.hidden]);
    }
    online.input(netKeys,p.yaw,p.pitch,canMove?next[3]:0,canMove?next[4]:-1);
    online.talk(canMove&&p.hidden===null&&(held.has('KeyV')||padHeld[padButtons.talk]));
    if(!canMove)return;
    const now=netClock+Math.min(550,performance.now()-netFrame);
    if(granny) {
      if(now>=timers.warm&&now>=timers.attack-860)moveGranny(p,sim.nav,netKeys,netState.grannySpeed);
    } else if(now>=timers.slow)moveSurvivor(p,sim.state,sim.nav,netKeys);
    if(p.hidden===null)p.eye=floorY(p.x,p.z)+(granny?1.86:p.crouch?1.03:1.66);
  }
  function updateCamera(dt) {
    const p=sim.state.player;
    const cover=sim.world.objects[p.hidden]??null;
    const bobbing=settings.motion&&!cover?Math.sin(bob)*bobStrength:0;
    if(cover!==lastCover) {
      hideEntry=cover&&dt&&settings.motion?{at:camera.position.clone(),age:0}:null;
      lastCover=cover;
    }
    let x=p.x,z=p.z,y=p.eye+bobbing,fade=0;
    if(cover) {
      [x,y,z]=cover.view;
      if(hideEntry) {
        const t=(hideEntry.age+=dt)/.38,{at}=hideEntry;
        const slide=smoothstep(t,.14,.91),lower=smoothstep(t,0,.63);
        x=T.MathUtils.lerp(at.x,x,slide);z=T.MathUtils.lerp(at.z,z,slide);y=T.MathUtils.lerp(at.y,y,lower);
        fade=Math.sin(Math.PI*clamp(t,0,1))*.87;
        if(t>=1)hideEntry=null;
      }else if(p.hideExit&&settings.motion) {
        const elapsed=online?Math.min(4,(performance.now()-netFrame)*.03):0;
        const t=clamp(1-(p.hideExit-elapsed)/HIDE_EXIT_TICKS,0,1);
        const [px,pz]=cover.peek,at=p.hideLeave;
        const cross=smoothstep(t,0,.67),step=smoothstep(t,.53,1);
        x=T.MathUtils.lerp(T.MathUtils.lerp(x,px,cross),at.x,step);
        z=T.MathUtils.lerp(T.MathUtils.lerp(z,pz,cross),at.z,step);
        y=T.MathUtils.lerp(y,floorY(at.x,at.z)+(cover.type==='wardrobe'?1.66:1.03),smoothstep(t,.61,1));
        fade=Math.sin(Math.PI*t)*.72;
      }
    }
    ui.coverTransition(fade);
    eye=dt?damp(eye,y,17,dt):y;
    camera.position.set(x,eye,z);
    if(mode!=='caught'){cameraYaw=p.yaw;cameraPitch=p.pitch;}
    let tilt=settings.motion&&!cover?Math.cos(bob*.5)*bobStrength*.44:0;
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
    const floor=floorAt(player.x,player.z),nightmare=!hasMap(difficulty),charge=sim.state.charge;
    const [lightX,lightZ]=sim.world.objects[player.hidden]?.peek??[player.x,player.z];
    const darkness=(nightmare?.72:1)*(floor==='attic'?.76:floor==='cellar'?.82:1);
    ambient.intensity=.76*darkness;
    if(Math.hypot(player.x-lastLightPos[0],player.z-lastLightPos[1])>1.3) {
      lastLightPos=[player.x,player.z];
      const dist=l=>Math.hypot(l.x-player.x,l.z-player.z)+(nav.clear(l.x,l.z,lightX,lightZ)?0:3.2);
      activeLights=world.lights.map(light=>[dist(light),light]).sort((a,b)=>a[0]-b[0])
        .slice(0,quality.lamps).map(([,light])=>light);
    }
    for(let i=0;i<quality.lamps;i++) {
      const src=activeLights[i],l=lampPool[i];if(!src)continue;
      l.position.set(src.x,src.y,src.z);l.color.setHex(src.color);
      const flicker=settings.motion&&src.flicker?1-Math.pow(Math.max(0,Math.sin(time*4+src.flicker)*Math.cos(time*15+src.flicker)),7)*.55:1;
      const spill=nav.clear(src.x,src.z,lightX,lightZ)?1:.21;
      l.intensity=damp(l.intensity,src.power*flicker*spill*darkness,8,dt);
    }
    const a=online?(netState.ai?.actor??netState.avatars.find(p=>p.role==='granny')):sim.state.brain.actor;
    const dx=a?a.x-player.x:99,dz=a?a.z-player.z:99,distance=Math.hypot(dx,dz);
    const facing=(-Math.sin(cameraYaw)*dx-Math.cos(cameraYaw)*dz)/(distance||1);
    const close=distance<3&&facing>.66&&nav.clear(player.x,player.z,a.x,a.z);
    const beam=close?clamp(.047+.095*distance*distance,.105,1):1;
    const active=sim.state.flash&&player.hidden===null;
    const pulse=settings.motion&&charge>0&&charge<=.1&&time%7.3>7.15?.26:1;
    flashlight.distance=active?nav.beamReach(player.x,player.z,cameraYaw):19;
    flashlight.intensity=damp(flashlight.intensity,(active?48*pulse:mode==='caught'?31:0)*beam,17,dt);
    flashlight.position.y=-.15+(settings.motion?Math.sin(bob)*bobStrength*.57:0);
    fill.intensity=(player.hidden!==null?.41:1.25)*darkness;
    dust.position.y=Math.sin(time*.47)*.21;
  }
  function startFrames(){if(!raf){lastFrame=performance.now();nextFrame=lastFrame;raf=requestAnimationFrame(frame);}}
  let lastProgress='',lastInventory='';
  function frame(now) {
    raf=0;
    if(!['play','caught'].includes(mode))return;
    if(online&&!netState)return;
    if(now+.8<nextFrame){raf=requestAnimationFrame(frame);return;}
    const elapsed=now-lastFrame,dt=clamp(elapsed/1000,0,.10);
    nextFrame=Math.max(nextFrame,now-frameTarget*.2)+frameTarget;
    const renderStart=performance.now();
    lastFrame=now;time+=dt;aimAssist-=dt;resize();
    if(mode==='play') {
      samplePad();
      accumulator+=dt;
      let moving=false,sprint=false;
      while(accumulator>=TICK&&mode==='play') {
        accumulator-=TICK;
        const before={x:sim.state.player.x,z:sim.state.player.z};
        if(online)matchInput(input());else applyInput(input());
        moving ||= Math.hypot(sim.state.player.x-before.x,sim.state.player.z-before.z)>TICK*.25;
      }
      const s=sim.state,p=s.player;
      if(mode==='play') {
        if(solo&&time>=nextSave){keepCheckpoint();nextSave=time+12;}
        const a=online?(netState.avatars.find(p=>p.role==='granny')??netState.ai?.actor):s.brain.actor;
        const tension=a?clamp(1-Math.hypot(p.x-a.x,p.z-a.z)/9.5,0,1):0;
        sprint=moving&&!s.tired&&!p.crouch&&Boolean(lastKeys&key.sprint);
        if(moving)bob+=dt*(sprint?13.7:p.crouch?6.1:9.9);
        bobStrength=damp(bobStrength,moving?(sprint?.039:p.crouch?.013:.021):0,14,dt);
        audio.listen(p);
        const threat=online?netState.ai?.state??'patrol':s.brain.state;
        audio.update(dt,tension,sprint,threat==='chase'||Boolean(online&&tension>.70),p.hidden!==null);
        ui.threat(threat,tension);ui.stamina(s.stamina,sprint);ui.hide(sim.world.objects[p.hidden]?.type);ui.flash(s.flash,s.charge,s.inventory.filter(i=>sim.world.objects[i].id==='battery').length,netState?.me.role==='granny');
        const progress=JSON.stringify(s.progress),inventory=s.inventory.join(',')+':'+s.selected;
        if(progress!==lastProgress){lastProgress=progress;ui.updateObjectives(s.progress,difficulty);}
        if(inventory!==lastInventory){lastInventory=inventory;ui.updateInventory(s.inventory.map(i=>sim.world.objects[i]),s.selected);}
        if(!online&&(randomSound-=dt)<=0) {
          randomSound=11+Math.random()*18;
          const floor=floorAt(p.x,p.z);
          const whisper=floor==='attic'?.87:floor==='upper'?.22:floor==='cellar'?0:.63;
          const kind=Math.random()<whisper?'whisper':'settle',at={x:p.x-4+Math.random()*8,z:p.z-3+Math.random()*6};
          audio.play(kind,at);caption(kind,p,at);
        }
        const area=areaAt(p.x,p.z);
        if(area!==previousArea){previousArea=area;ui.area(area);}
        if((hudTick-=dt)<=0){hudTick=.052;ui.prompt(online?matchPrompt(p):sim.prompt());}
        map?.draw(p,sim,netState,dt);
      }
    }
    syncWorld(dt);updateCamera(dt);updateLighting(dt);
    renderer.render(scene,camera);
    if(settings.adaptive&&elapsed<120)scaling.sample(elapsed,frameTarget,performance.now()-renderStart);
    if(['play','caught'].includes(mode))raf=requestAnimationFrame(frame);
  }
  function matchPrompt(p) {
    const {me,avatars}=netState;
    if(me.status!=='active')return '';
    const aimed=o=>Math.hypot(o.x-p.x,o.z-p.z)<1.55&&Math.cos(Math.atan2(p.x-o.x,p.z-o.z)-p.yaw)>.66;
    if(me.role==='granny')return sim.world.doors.some(d=>d.kind==='door'&&!d.secret&&!d.open&&aimed(d))?'Open door':'Swing weapon';
    const down=avatars.find(o=>o.status==='captured'&&aimed(o));
    return down?'Rescue '+down.name:sim.prompt();
  }
  configure();
  return {begin,beginMatch,closeMatch:endMatch,resume,menu,pause,nextNight,configure,gyro,checkpoint,get mode(){return mode;}};
}
