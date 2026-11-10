import {key} from './simulation.js';

const clamp=(x,min,max)=>Math.max(min,Math.min(max,x));
const wrap=angle=>Math.atan2(Math.sin(angle),Math.cos(angle));
export const padButtons={use:0,crouch:1,light:2,journal:3,previous:4,next:5,drop:6,sprint:7,back:8,pause:9,trap:10,bolt:11,talk:12};

export function movementBits(x,y,deadzone=.22) {
  if(Math.hypot(x,y)<deadzone)return 0;
  const angle=Math.atan2(y,x),sector=(Math.round(angle/(Math.PI/4))+8)%8;
  return [key.right,key.right|key.back,key.back,key.left|key.back,key.left,key.left|key.forward,key.forward,key.right|key.forward][sector];
}
export function aimAxis(value) {
  const amount=Math.abs(value??0);
  return amount<.14?0:Math.sign(value)*((amount-.14)/.86)**1.5;
}
export function supportedPad() {
  try{return Array.from(navigator.getGamepads?.()??[]).find(p=>p?.connected&&p.mapping==='standard')??null;}
  catch{return null;}
}
export function bindJoystick(surface,thumb,onUse) {
  let pointer=null,bounds,x=0,y=0;
  function reset(){
    pointer=null;x=y=0;thumb.style.translate='0px 0px';surface.removeAttribute('data-held');
  }
  function move(e){
    const range=bounds.width*.37;
    x=(e.clientX-bounds.left-bounds.width/2)/range;y=(e.clientY-bounds.top-bounds.height/2)/range;
    const length=Math.max(1,Math.hypot(x,y));x/=length;y/=length;
    thumb.style.translate=(x*range)+'px '+(y*range)+'px';
  }
  surface.addEventListener('pointerdown',e=>{
    if(pointer!==null||e.button!==0)return;
    e.preventDefault();onUse();
    pointer=e.pointerId;bounds=surface.getBoundingClientRect();
    surface.setPointerCapture(pointer);surface.setAttribute('data-held','');move(e);
  });
  surface.addEventListener('pointermove',e=>{if(e.pointerId===pointer)move(e);});
  for(const type of ['pointerup','pointercancel','lostpointercapture'])surface.addEventListener(type,e=>{if(e.pointerId===pointer)reset();});
  return {reset,get keys(){return movementBits(x,y);}};
}
export function gyroControl(onDelta,isActive) {
  let previous=null,lastScreen=null,ready=false;
  function read(e) {
    if(!ready||!isActive()||e.alpha===null||e.beta===null||e.gamma===null){previous=null;return;}
    const rotation=(screen.orientation?.angle??window.orientation??0)*Math.PI/180;
    const next=[e.alpha*Math.PI/180,e.beta*Math.PI/180,e.gamma*Math.PI/180];
    if(previous&&lastScreen===rotation) {
      const yaw=wrap(next[0]-previous[0]),beta=wrap(next[1]-previous[1]),gamma=wrap(next[2]-previous[2]);
      onDelta(clamp(yaw,-.16,.16)*730,clamp(beta*Math.cos(rotation)+gamma*Math.sin(rotation),-.16,.16)*730);
    }
    previous=next;lastScreen=rotation;
  }
  window.addEventListener('deviceorientation',read);
  window.addEventListener('orientationchange',()=>{previous=null;});
  return {
    get ready(){return ready;},
    reset(){previous=null;},
    allow(value){ready=value;previous=null;},
    disable(){ready=false;previous=null;}
  };
}
export async function requestGyro() {
  const api=window.DeviceOrientationEvent;
  if(!api)return false;
  try{return typeof api.requestPermission!=='function'||await api.requestPermission()==='granted';}
  catch{return false;}
}
