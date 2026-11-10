import {clamp,levels} from './rules.js';

export const sharedPreferences=['volume','music','sensitivity','touchSensitivity','padSensitivity','invertX','invertY','brightness','motion','footstepCues'];
const numbers={
  volume:[0,1,.72],music:[0,1,.55],sensitivity:[.25,2.5,1],touchSensitivity:[.3,2.8,1.15],
  padSensitivity:[.4,2.5,1],brightness:[.72,1.65,1],joystickSize:[.7,1.32,1],joystickOpacity:[.3,1,.82],
  joystickInset:[0,36,8],joystickHeight:[0,64,0]
};
const choices={
  graphics:['auto','low','medium','high','ultra'],frameRate:['auto','30','60'],
  controlsMode:['auto','touch','traditional'],joystickSide:['left','right']
};
const switches={footstepCues:true,invertX:false,invertY:false,motion:true,gyro:false,haptics:true,adaptive:true};

export function normalizePreferences(input={},reduced=false) {
  const settings={difficulty:Object.hasOwn(levels,input.difficulty)?input.difficulty:'normal'};
  for(const [name,[min,max,fallback]] of Object.entries(numbers)){
    settings[name]=Number.isFinite(input[name])?clamp(input[name],min,max):fallback;
  }
  for(const [name,values] of Object.entries(choices))settings[name]=values.includes(input[name])?input[name]:values[0];
  for(const [name,value] of Object.entries(switches)){
    settings[name]=typeof input[name]==='boolean'?input[name]:name==='motion'?!reduced:value;
  }
  return settings;
}

export function preferencePatch(value) {
  const patch={};
  for(const name of sharedPreferences) {
    if(!Object.hasOwn(value,name))continue;
    const field=value[name],range=numbers[name];
    if(range?typeof field!=='number'||!Number.isFinite(field)||field<range[0]||field>range[1]:typeof field!=='boolean')return null;
    patch[name]=field;
  }
  return patch;
}
