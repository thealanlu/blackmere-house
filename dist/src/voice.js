import {api} from './online.js';

export function proximityVoice(room,report,muted) {
  const peers=new Map();
  const endpoint='multiplayer/'+room.code+'/voice';
  let stream,context,microphone,timer,version=null,enabled=false,working=false,held=false;
  let after=0,signals=[],waiting=[],lastFrame=0,blocked=new Set(),epoch=0;
  const request=(data={})=>api(endpoint,{method:'POST',retry:false,data:{game:room.game,after,signals:[],...data}});

  function retire(id) {
    const peer=peers.get(id);
    if(!peer)return;
    peer.pc.close();peer.out.disconnect();peer.input?.disconnect();peer.output.disconnect();
    microphone?.disconnect(peer.out);
    peers.delete(id);
  }
  function close() {
    epoch++;held=false;enabled=false;version=null;signals=[];waiting=[];after=0;
    clearTimeout(timer);
    for(const id of peers.keys())retire(id);
    stream?.getTracks().forEach(track=>track.stop());stream=null;
    context?.close().catch(()=>{});context=null;microphone=null;
  }
  function describe() {
    const connections=[...peers.values()];
    const live=connections.filter(p=>p.pc.connectionState==='connected').length;
    report(enabled?(live?live+' voice '+(live===1?'connection':'connections')+' · hold V to speak':
      connections.some(p=>p.pc.connectionState==='failed'||p.failed)?'Voice could not connect on this network.':
        peers.size?'Connecting voice…':'Waiting for another player to enable voice'):'Voice is off.',enabled);
  }
  function queue(peer,value) {
    if(enabled&&peer.pc.connectionState!=='closed')signals.push({to:peer.id,version:peer.version,value});
  }
  function create(info) {
    const {id}=info;
    const pc=new RTCPeerConnection({iceServers:[{urls:'stun:stun.cloudflare.com:3478'}]});
    const destination=context.createMediaStreamDestination(),out=context.createGain(),output=context.createGain();
    out.gain.value=0;
    output.gain.value=muted(id)||!info.gain?0:1;
    microphone.connect(out).connect(destination);output.connect(context.destination);
    const peer={...info,pc,out,output,track:destination.stream.getAudioTracks()[0],ice:[],input:null,failed:false};
    peers.set(id,peer);
    pc.onicecandidate=e=>{if(e.candidate)queue(peer,{type:'ice',...e.candidate.toJSON()});};
    pc.onconnectionstatechange=describe;
    pc.ontrack=e=>{
      peer.input?.disconnect();
      if(context&&e.track.kind==='audio') {
        peer.input=context.createMediaStreamSource(new MediaStream([e.track]));
        peer.input.connect(output);
      }
    };
    if(room.me<id) {
      pc.addTransceiver(peer.track,{direction:'sendrecv'});
      pc.createOffer().then(offer=>pc.setLocalDescription(offer)).then(()=>{
        queue(peer,{type:'offer',sdp:pc.localDescription.sdp});
      }).catch(()=>{peer.failed=true;describe();});
    }
    return peer;
  }
  async function deliver(peer,value) {
    const {pc}=peer;
    if(value.type==='ice') {
      if(!pc.remoteDescription)peer.ice.push(value);else await pc.addIceCandidate(value);
      return;
    }
    if((value.type==='offer'&&room.me<peer.id)||(value.type==='answer'&&room.me>peer.id))return;
    await pc.setRemoteDescription({type:value.type,sdp:value.sdp});
    for(const candidate of peer.ice.splice(0))await pc.addIceCandidate(candidate).catch(()=>{});
    if(value.type==='offer') {
      const transceiver=pc.getTransceivers().find(t=>t.receiver.track.kind==='audio');
      if(!transceiver)return;
      transceiver.direction='sendrecv';
      await transceiver.sender.replaceTrack(peer.track);
      await pc.setLocalDescription(await pc.createAnswer());
      queue(peer,{type:'answer',sdp:pc.localDescription.sdp});
    }
  }
  function volumes() {
    if(!enabled||!context)return;
    const now=context.currentTime,fresh=performance.now()-lastFrame<750;
    if(stream)stream.getAudioTracks()[0].enabled=held&&fresh;
    for(const p of peers.values()) {
      const available=fresh&&!blocked.has(p.id);
      p.out.gain.setTargetAtTime(available&&held?p.gain:0,now,.024);
      p.output.gain.setTargetAtTime(available&&p.gain>0&&!muted(p.id)?1:0,now,.03);
    }
  }
  async function poll(token) {
    if(!enabled||token!==epoch)return;
    volumes();
    const batch=signals.splice(0,8);
    try {
      const result=await request({signals:batch});
      if(!enabled||token!==epoch)return;
      if(result.version!==version){close();report('Voice was disconnected.',false);return;}
      blocked=new Set(result.blocked);after=result.after;
      for(const id of blocked)retire(id);
      const now=Date.now();
      waiting.push(...result.signals.map(item=>({...item,until:now+5000})));
      const pending=[];
      for(const item of waiting) {
        const peer=peers.get(item.from);
        if(peer?.version===item.version)await deliver(peer,item.value).catch(()=>{});
        else if(item.until>now)pending.push(item);
      }
      waiting=pending;
      describe();
    }catch(error) {
      if(token!==epoch)return;
      if(error.status===403||error.status===404||error.status===409){close();report(error.message,false);return;}
      signals.unshift(...batch);
      report('Reconnecting voice…',enabled);
    }finally{
      if(enabled&&token===epoch)timer=setTimeout(()=>poll(token),signals.length?320:850);
    }
  }
  return {
    async toggle() {
      if(working)return;
      if(enabled) {
        close();report('Voice is off.',false);
        await request({enabled:false}).catch(()=>{});
        return;
      }
      if(!navigator.mediaDevices?.getUserMedia||typeof RTCPeerConnection==='undefined'){
        report('This browser cannot start proximity voice.',false);return;
      }
      working=true;const token=++epoch;
      report('Waiting for microphone permission…',false);
      try {
        context=new AudioContext();await context.resume();
        const mic=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true},video:false});
        if(token!==epoch){mic.getTracks().forEach(track=>track.stop());return;}
        stream=mic;stream.getAudioTracks()[0].enabled=false;
        microphone=context.createMediaStreamSource(stream);
        const result=await request({enabled:true});
        if(token!==epoch)return;
        enabled=true;version=result.version;after=result.after;describe();poll(token);
      }catch(error) {
        if(token===epoch){close();report(error.message||'Microphone permission was unavailable.',false);}
      }finally{working=false;}
    },
    update(packet) {
      if(!enabled)return;
      if(packet.me.status!=='active'||packet.phase!=='play') {
        this.stop();return;
      }
      lastFrame=performance.now();
      const incoming=new Map(packet.peers.filter(p=>!blocked.has(p.id)).map(p=>[p.id,p]));
      for(const [id,p] of peers)if(incoming.get(id)?.version!==p.version)retire(id);
      for(const [id,info] of incoming) {
        const peer=peers.get(id)??create(info);
        peer.gain=info.gain;
      }
      volumes();
    },
    talk(active) {
      if(held===active)return;
      held=active;volumes();
    },
    stop() {
      const wasEnabled=enabled;close();
      report('Voice is off.',false);
      if(wasEnabled)request({enabled:false}).catch(()=>{});
    }
  };
}
