// Four phrases for low strings and felt piano, with a separate pursuit rhythm.
const phrases=[
  {bass:38,interval:7,notes:[[.65,62],[2.4,69],[4.15,63]]},
  {bass:34,interval:7,notes:[[1.25,65],[3.5,62]]},
  {bass:41,interval:6,notes:[[.45,60],[2.1,66],[4.5,65]]},
  {bass:37,interval:7,notes:[[1,64],[3.8,61],[5.05,57]]}
];
const hz=midi=>440*2**((midi-69)/12);

export function createScore(ctx,destination) {
  const level=ctx.createGain(),ducking=ctx.createGain();
  ducking.connect(level).connect(destination);
  let track,nextPhrase,nextPulse,phrase=0,pulse=0;

  function voice(at,midi,length,peak,attack,type,cutoff,detune=0) {
    const osc=ctx.createOscillator(),filter=ctx.createBiquadFilter(),envelope=ctx.createGain();
    osc.type=type;osc.frequency.value=hz(midi);osc.detune.value=detune;
    filter.type='lowpass';filter.frequency.value=cutoff;
    envelope.gain.setValueAtTime(.0001,at);
    envelope.gain.exponentialRampToValueAtTime(peak,at+attack);
    envelope.gain.exponentialRampToValueAtTime(.0001,at+length);
    osc.connect(filter).connect(envelope).connect(track);
    osc.start(at);osc.stop(at+length+.03);
  }

  function enable(on) {
    const now=ctx.currentTime;
    if(on&&!track) {
      track=ctx.createGain();track.gain.value=1;track.connect(ducking);
      nextPhrase=now+.08;nextPulse=now+.06;
    } else if(!on&&track) {
      const tail=track;
      tail.gain.setTargetAtTime(0,now,.055);
      setTimeout(()=>tail.disconnect(),420);
      track=null;
    }
  }

  function update(chasing) {
    if(!track)return;
    const now=ctx.currentTime;
    if(nextPhrase<now+.11) {
      const at=Math.max(now+.02,nextPhrase),{bass,interval,notes}=phrases[phrase++%phrases.length];
      voice(at,bass,6.7,.10,1.30,'triangle',395,-5);
      voice(at+.24,bass+interval,6.3,.057,1.52,'sawtooth',485,7);
      for(const [offset,note] of notes) {
        voice(at+offset,note,1.87,.045,.018,'triangle',1280);
        voice(at+offset+.013,note+12,.39,.014,.024,'sine',1800,-9);
      }
      nextPhrase=at+6;
    }
    if(!chasing) {
      nextPulse=now+.05;pulse=0;
    } else if(nextPulse<now+.07) {
      const at=Math.max(now+.016,nextPulse),accent=pulse++%4===0;
      voice(at,accent?29:31,accent?.35:.23,accent?.17:.09,.02,'triangle',420);
      nextPulse=at+.34;
    }
  }

  return {
    enable,update,
    setVolume(value){level.gain.setTargetAtTime(value,ctx.currentTime,.06);},
    duck(seconds) {
      const now=ctx.currentTime;
      ducking.gain.cancelScheduledValues(now);
      ducking.gain.setTargetAtTime(.24,now,.024);
      ducking.gain.setTargetAtTime(1,now+seconds,.16);
    }
  };
}
