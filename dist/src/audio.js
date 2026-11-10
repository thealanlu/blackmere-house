import {createScore} from './score.js';

export function createAudio() {
  let ctx,master,air,hiss,room,listener,score,dir=0,volume=.75,music=.55,beat=0,breath=0,active=false;
  let origin={x:0,z:0};
  function init() {
    if(ctx){ctx.resume().catch(()=>{});return;}
    try {ctx=new AudioContext();} catch{return;}
    master=ctx.createGain();master.gain.value=volume*.64;master.connect(ctx.destination);
    score=createScore(ctx,master);score.setVolume(music);
    listener=ctx.createGain();listener.gain.value=1;listener.connect(master);
    hiss=ctx.createBuffer(1,ctx.sampleRate*2,ctx.sampleRate);
    const data=hiss.getChannelData(0);
    for(let i=0;i<data.length;i++)data[i]=(Math.random()-.5)*2;
    const impulse=ctx.createBuffer(2,ctx.sampleRate,ctx.sampleRate);
    for(let i=0;i<2;i++) {
      const a=impulse.getChannelData(i);
      for(let j=0;j<a.length;j++)a[j]=(Math.random()-.5)*Math.pow(1-j/a.length,4)*.53;
    }
    room=ctx.createConvolver();room.buffer=impulse;
    const wet=ctx.createGain();wet.gain.value=.18;room.connect(wet).connect(listener);
    air=ctx.createGain();air.gain.value=0;air.connect(listener);
    const hum=ctx.createOscillator();hum.type='sine';hum.frequency.value=43;hum.connect(air);hum.start();
    const wind=ctx.createBufferSource();wind.buffer=hiss;wind.loop=true;
    const low=ctx.createBiquadFilter();low.type='lowpass';low.frequency.value=280;
    wind.connect(low).connect(air);wind.start();
    ctx.resume().catch(()=>{});
  }
  function send(node,pos,dry=1,echo=true) {
    const g=ctx.createGain();
    if(pos) {
      const dx=pos.x-origin.x,dz=pos.z-origin.z,d=Math.hypot(dx,dz);
      const pan=ctx.createStereoPanner();pan.pan.value=Math.max(-.94,Math.min(.94,(dx*Math.cos(dir)-dz*Math.sin(dir))/(d||1)));
      if(pos.muffled) {
        const low=ctx.createBiquadFilter();low.type='lowpass';low.frequency.value=590;
        node.connect(low).connect(pan);
      } else node.connect(pan);
      pan.connect(g);g.gain.value=dry*(pos.spatialGain??1)/(1+d*.19);
    }else {node.connect(g);g.gain.value=dry;}
    g.connect(listener);if(echo)g.connect(room);
  }
  function noise(duration,freq,gain,pos,delay=0,type='lowpass',destination=null) {
    if(!ctx||!active)return;
    const now=ctx.currentTime+delay;
    const src=ctx.createBufferSource();src.buffer=hiss;
    const filter=ctx.createBiquadFilter();filter.type=type;filter.frequency.value=freq;filter.Q.value=type==='bandpass'?1.9:.65;
    const envelope=ctx.createGain();envelope.gain.setValueAtTime(.0001,now);
    envelope.gain.exponentialRampToValueAtTime(gain,now+Math.min(.036,duration*.17));
    envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);
    src.connect(filter).connect(envelope);
    if(destination)envelope.connect(destination);else send(envelope,pos);
    src.start(now,Math.random());src.stop(now+duration+.02);
  }
  function tone(duration,from,to,gain,pos,type='sine',delay=0,destination=null) {
    if(!ctx||!active)return;
    const now=ctx.currentTime+delay;
    const source=ctx.createOscillator();source.type=type;
    source.frequency.setValueAtTime(from,now);source.frequency.exponentialRampToValueAtTime(to,now+duration);
    const envelope=ctx.createGain();envelope.gain.setValueAtTime(.0001,now);
    envelope.gain.exponentialRampToValueAtTime(gain,now+.019);
    envelope.gain.exponentialRampToValueAtTime(.0001,now+duration);
    source.connect(envelope);
    if(destination)envelope.connect(destination);else send(envelope,pos);
    source.start(now);source.stop(now+duration+.025);
  }
  function footstep({pan,gain,muffled,stone,running,foot}) {
    if(!ctx||!active)return;
    const filter=ctx.createBiquadFilter(),stereo=ctx.createStereoPanner(),level=ctx.createGain();
    filter.type='lowpass';filter.frequency.value=muffled?490:3700;
    stereo.pan.value=pan*.91;level.gain.value=gain*(running?1.13:1);
    filter.connect(stereo).connect(level).connect(listener);level.connect(room);
    const variation=foot===0?1:.87;
    // Heel strike, weight on the boards, then the scrape of the trailing sole.
    tone(.20,(stone?93:74)*variation,stone?46:36,.40,null,'sine',0,filter);
    noise(.115,stone?830:525,.32,null,0,'lowpass',filter);
    noise(running?.17:.24,stone?1690:1120,.21,null,.037,'bandpass',filter);
    if(!stone)tone(.22,212*variation,150,.052,null,'triangle',.065,filter);
    if(gain>.25)score.duck(.22);
  }
  function play(kind,pos) {
    if(kind==='step') {
      noise(.14,310,.099,pos);
      tone(.12,68+Math.random()*22,40,.12,pos);
      if(Math.random()<.28)noise(.25,790,.10,pos,.044,'bandpass');
    }
    if(kind==='door') {
      noise(.49,560,.26,pos,0,'bandpass');
      tone(.49,217,77,.054,pos,'triangle');
      noise(.15,302,.22,pos,.34);
    }
    if(kind==='drop'){noise(.29,1550,.47,pos,0,'bandpass');tone(.36,313,101,.098,pos,'triangle');}
    if(kind==='item'){noise(.16,2530,.12,pos,0,'bandpass');tone(.24,390,225,.046,pos,'triangle');}
    if(kind==='power'){tone(.66,82,59,.17,pos,'sawtooth');noise(.24,1950,.22,pos,0,'bandpass');}
    if(kind==='whisper')noise(.94,890,.105,pos,0,'bandpass');
    if(kind==='settle') {
      noise(1.04,220,.11,pos,0,'lowpass');
      tone(.73,124,95,.025,pos,'triangle',.09);
    }
    if(kind==='swing')noise(.28,935,.20,pos,0,'bandpass');
    if(kind==='attack') {
      score?.duck(1);
      noise(.78,1470,.65,pos,0,'bandpass');noise(.56,380,.48,pos);
      tone(.88,498,91,.26,pos,'sawtooth');
    }
  }
  return {
    init,play,footstep,
    listen(player){origin=player;dir=player.yaw;},
    setVolume(v){volume=v;if(master)master.gain.setTargetAtTime(v*.64,ctx.currentTime,.06);},
    setMusic(v){music=v;score?.setVolume(v);},
    enable(v){active=v;if(air)air.gain.setTargetAtTime(v?.09:0,ctx.currentTime,.18);score?.enable(v);},
    update(dt,tension,sprint,chasing) {
      if(!ctx||!active)return;
      score.update(chasing);
      air.gain.setTargetAtTime(.071+tension*.085,ctx.currentTime,.22);
      beat-=dt;breath-=dt;
      if(tension>.15&&beat<=0) {
        beat=1.35-tension*.8;
        tone(.14,61,34,.12+tension*.18);tone(.13,55,30,.087+tension*.12,null,'sine',.13);
      }
      if((sprint||tension>.55)&&breath<=0) {
        breath=sprint?.59:1.21;noise(.40,670,.089,null,0,'bandpass');
      }
    }
  };
}
