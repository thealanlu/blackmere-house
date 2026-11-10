export const presets={
  low:{dpr:.86,pixels:740_000,lamps:2,particles:0,shadow:0,texture:256,fps:30},
  medium:{dpr:1.16,pixels:1_450_000,lamps:3,particles:280,shadow:0,texture:384,fps:60},
  high:{dpr:1.55,pixels:2_900_000,lamps:4,particles:550,shadow:512,texture:512,fps:60},
  ultra:{dpr:2,pixels:4_600_000,lamps:5,particles:900,shadow:1024,texture:512,fps:60}
};

export function recommendedPreset({coarse=false,memory=0,cores=0,texture=8192}={}) {
  if(texture<4096||(coarse&&(memory>0&&memory<=4||cores>0&&cores<=4)))return 'low';
  return coarse?'medium':'high';
}

export function pixelRatio(preset,width,height,deviceRatio,scale=1) {
  return Math.min(deviceRatio||1,preset.dpr,Math.sqrt(preset.pixels/Math.max(1,width*height)))*scale;
}

export function adaptiveResolution() {
  let scale=1,slow=0,fast=0;
  return {
    get scale(){return scale;},
    reset(){scale=1;slow=fast=0;},
    sample(elapsed,target,renderCost) {
      const behind=elapsed>target*1.24||renderCost>target*.86;
      slow=behind?slow+elapsed:Math.max(0,slow-elapsed*.8);
      fast=behind?0:fast+elapsed;
      if(slow>1200){scale=Math.max(.63,scale-.09);slow=fast=0;}
      if(fast>6200&&scale<1){scale=Math.min(1,scale+.05);slow=fast=0;}
      return scale;
    }
  };
}
