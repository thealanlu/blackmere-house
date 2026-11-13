import {api} from './online.js';
import {levels} from './rules.js';
import {MATCH_VERSION} from './match.js';
import {proximityVoice} from './voice.js';

const $=id=>document.getElementById(id);
const post=(path,data,options={})=>api(path,{method:'POST',data,...options});
const base='multiplayer';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
const title=mode=>mode==='pvp'?'Survivors vs. Granny':'Co-op vs. AI';
const role=value=>({granny:'Granny',survivor:'Survivor',random:'Random'})[value]??'Survivor';
const time=seconds=>Math.floor(seconds/60)+':'+String(seconds%60).padStart(2,'0');
const percent=(a,b)=>b?Math.round(100*a/b)+'%':'—';
const statusLabel={active:'In the house',captured:'Captured',escaped:'Escaped',eliminated:'Eliminated'};
function node(tag,value,cls) {
  const el=document.createElement(tag);
  if(value!==undefined)el.textContent=value;
  if(cls)el.className=cls;
  return el;
}
function button(value,fn) {
  const el=node('button',value,'text-button');el.type='button';el.onclick=fn;return el;
}
function put(id,text) {
  const el=$(id);
  if(el.textContent!==text)el.textContent=text;
}
function read(key,fallback) {
  try{return sessionStorage.getItem(key)??fallback;}catch{return fallback;}
}
function remember(code) {
  try{if(code)sessionStorage.setItem('blackmere.room',code);else sessionStorage.removeItem('blackmere.room');}catch{}
}
const roomCode=/^[A-HJ-NP-Z2-9]{6}$/;
const inviteCode=new URLSearchParams(location.search).get('room')?.toUpperCase();

function transport(room,onResult,onLeave,onClosed,voice) {
  const path=base+'/'+room.code+'/exchange';
  let active=false,idling=false,timer,controller,seq=0,after=0,worldVersion=0,flight=null,known=false,retries=0,receive,connection;
  const input={keys:0,yaw:0,pitch:0,actions:0,slot:-1};

  async function exchange() {
    if(!active)return;
    const started=performance.now();
    if(!flight) {
      flight={...input,seq:known?++seq:0};
      input.actions=0;input.slot=-1;
    }
    controller=new AbortController();
    const timeout=setTimeout(()=>controller.abort(),2100);
    try {
      const packet=await post(path,{...flight,version:MATCH_VERSION,ticket:room.ticket,game:room.game,after,worldVersion},
        {retry:false,signal:controller.signal});
      if(!active)return;
      if(!known){seq=packet.me.seq;known=true;}
      flight=null;after=packet.lastEvent;retries=0;connection('');
      voice?.update(packet);
      receive(packet,performance.now()-started);
      worldVersion=packet.worldVersion;
    }catch(e) {
      if(!active)return;
      if([400,403,404,409].includes(e.status)){onClosed(e.message);return;}
      if(e.status!==429||retries>3)connection('Connection interrupted · reconnecting');
      retries++;
    }finally {
      clearTimeout(timeout);
      const interval=document.hidden?900:idling?315:162;
      if(active)timer=setTimeout(exchange,retries?Math.min(1550,175*2**Math.min(retries,4)):Math.max(35,interval-(performance.now()-started)));
    }
  }
  return {
    start(onPacket,onNetwork){active=true;receive=onPacket;connection=onNetwork;exchange();},
    stop(){active=false;clearTimeout(timer);controller?.abort();voice?.stop();},
    input(keys,yaw,pitch,actions,slot) {
      idling=false;
      input.keys=keys;input.yaw=Math.round(wrap(yaw)*1000);input.pitch=Math.round(pitch*1000);
      input.actions|=actions;if(slot!==-1)input.slot=slot;
    },
    idle(){idling=true;input.keys=0;input.actions=0;input.slot=-1;voice?.talk(false);},
    talk(value){voice?.talk(value);},
    complete:onResult,leave:onLeave
  };
}

export function bindMultiplayer({navigate,isOpen,social,game,currentGame}) {
  let room=null,packet=null,busy=false,loading=false,lastDirectory=0,preview,previewLoad,previewFrame,previewAt=0,angle=-.28;
  let lastRoom='',lastHost='',lastChat='',lastReport='',lastBoard=0,friendRoom='',opening=0;
  let muted=new Set(),voice;
  try {muted=new Set(JSON.parse(localStorage.getItem('blackmere.muted')??'[]'));}catch{}
  let pending=roomCode.test(inviteCode??'')?inviteCode:read('blackmere.room','');
  const online=()=>Boolean(social?.profile);
  const message=(text='',error=false)=>{put('mpStatus',text);$('mpStatus').toggleAttribute('data-error',error);};
  const formSettings=(edit=false)=>({
    mode:$(edit?'mpEditMode':'mpMode').value,access:$(edit?'mpEditAccess':'mpAccess').value,
    minutes:Number($(edit?'mpEditMinutes':'mpMinutes').value),difficulty:$(edit?'mpEditDifficulty':'mpDifficulty').value,
    voice:$(edit?'mpVoiceEdit':'mpVoiceRoom').checked
  });
  const rq=(op,data={})=>post(room?base+'/'+room.code:base,{op,...data});
  function clearSeat() {
    room=null;packet=null;pending='';friendRoom='';remember('');
    $('mpRoom').hidden=true;
  }
  function checkAccount() {
    if(room&&room.me!==social.profile?.id)clearSeat();
  }

  function mutedUser(id) {
    if(muted.has(id))muted.delete(id);else muted.add(id);
    try{localStorage.setItem('blackmere.muted',JSON.stringify([...muted]));}catch{}
    lastRoom='';lastChat='';
    if(room)renderRoom(room);
  }
  function renderChat(lines,target) {
    const visible=lines.filter(line=>!muted.has(line.id));
    const signature=target+visible.map(line=>line.key).join(',');
    if(lastChat===signature)return;
    lastChat=signature;
    const list=$(target);
    list.replaceChildren(...(visible.length?visible.map(m=>{
      const row=node('li'),name=node('strong',m.name),text=node('span',m.text);
      row.append(name,text);return row;
    }):[node('li','No messages yet.','mp-empty')]));
    list.scrollTop=list.scrollHeight;
  }
  function animatePreview(now) {
    if(!room||!isOpen('multiplayer')){previewFrame=null;return;}
    if(preview&&!document.hidden&&now-previewAt>=31) {
      angle+=matchMedia('(prefers-reduced-motion: reduce)').matches?0:.011;
      previewAt=now;
      const own=room.members.find(m=>m.id===room.me);
      const hunter=room.mode==='pvp'&&(own?.role==='granny'||(own?.preference==='granny'&&room.phase==='lobby'));
      preview.draw(angle,hunter);
      put('mpPreviewCaption',hunter?'THE CARETAKER':'BLACKMERE FIELD OUTFIT');
    }
    previewFrame=requestAnimationFrame(animatePreview);
  }
  function startPreview() {
    if(previewFrame||preview===false||!isOpen('multiplayer'))return;
    if(!preview) {
      previewLoad??=import('./survivor.js').then(({roomPreview})=>{
        if(isOpen('multiplayer')&&room)preview=roomPreview($('mpPreview'));
      }).catch(()=>{preview=false;}).finally(()=>{previewLoad=null;if(preview)startPreview();});
      return;
    }
    if(preview)previewFrame=requestAnimationFrame(animatePreview);
  }
  function renderRoom(next) {
    room=next;
    remember(room.code);pending=room.code;
    const url=new URL(location.href);
    if(url.searchParams.has('room')){url.searchParams.delete('room');history.replaceState(null,'',url);}
    $('mpDirectory').hidden=true;$('mpGate').hidden=true;$('mpRoom').hidden=false;
    const lobby=room.phase==='lobby',playing=room.phase==='play',host=room.hostId===room.me;
    const own=room.members.find(m=>m.id===room.me),granny=room.mode==='pvp';
    const connected=room.members.filter(m=>m.online);
    put('mpRoomCode',room.code);put('mpRoomType',title(room.mode)+' · '+levels[room.difficulty].label+' · '+(room.access==='public'?'Public':'Private')+(room.voice?' · Voice opt-in':''));
    put('mpCount',connected.length+' / '+room.capacity);
    put('mpRosterTitle',lobby?'The crew':playing?'In the house':'Match record');
    put('mpIntro',lobby?'Choose a role, ready up, and enter together.':
      playing?'The doors are open. Your seat is reserved while you reconnect.':room.winner==='survivors'?'The Survivors won.':'The Caretaker won.');
    const signature=JSON.stringify(room.members)+room.phase+room.hostId;
    if(signature!==lastRoom) {
      lastRoom=signature;
      $('mpRoster').replaceChildren(...room.members.map(m=>{
        const li=node('li',undefined,'mp-player');
        const label=node('div');
        label.append(node('strong',m.name+(m.id===room.me?' (you)':'')),node('small',
          (m.id===room.hostId?'Host · ':'')+role(m.role??m.preference)+(m.online?'':' · Reconnecting')));
        if(room.phase==='result'&&m.captures!==undefined)label.append(node('small',m.role==='granny'?
          m.captures+' captures':m.escapes+' escapes · '+m.rescues+' rescues · '+m.objectives+' objectives'));
        const state=lobby?(m.ready?'Ready':'Waiting'):statusLabel[m.status]??'Waiting';
        li.append(node('span',m.name[0].toUpperCase(),'mp-initial'),label,node('span',state,m.ready&&lobby?'mp-ready':'mp-chip'));
        if(m.id!==room.me) {
          li.append(button(muted.has(m.id)?'Unmute':'Mute',()=>mutedUser(m.id)));
          if(room.phase==='result')li.append(button('Block',async()=>{
            try {
              await post('friends',{target:m.id,action:'block'});
              if(!muted.has(m.id))mutedUser(m.id);
              message(m.name+' was blocked.');
            }catch(e){message(e.message,true);}
          }));
        }
        return li;
      }));
    }
    $('mpReadyPanel').hidden=!lobby;$('mpRole').disabled=!granny;
    $('mpRole').querySelector('[value=granny]').disabled=!granny;
    $('mpRole').value=granny?own?.preference??'random':'survivor';
    put('mpReady',own?.ready?'Unready':'Ready');
    $('mpStart').hidden=!lobby||!host;
    $('mpStart').disabled=connected.length<2||connected.length!==room.members.length||!room.members.every(m=>m.ready);
    $('mpEnter').hidden=!playing;$('mpRematch').hidden=room.phase!=='result'||!host;
    put('mpMatchState',lobby?(connected.length<2?'Waiting for at least one more player.':'The host can start once everyone is ready.'):
      playing?'The timer is running.':(room.reason??'')+' '+(room.ranked?'Competitive points recorded.':'Casual match · no competitive points.'));
    $('mpHostSettings').hidden=!host||!lobby;
    $('mpQueue').disabled=room.queue||room.members.length>=room.capacity;
    put('mpQueue',room.queue?'Finding players…':'Find Players for Party');
    $('mpFriendBox').hidden=!lobby;
    $('mpChatBox').hidden=playing;
    $('mpReportBox').hidden=room.phase!=='result'||room.members.length<2;
    const hostSettings=JSON.stringify([room.code,room.mode,room.access,room.minutes,room.difficulty,room.voice]);
    if(hostSettings!==lastHost) {
      lastHost=hostSettings;
      $('mpEditMode').value=room.mode;$('mpEditAccess').value=room.access;$('mpEditMinutes').value=room.minutes;$('mpEditDifficulty').value=room.difficulty;
      $('mpVoiceEdit').checked=room.voice;
    }
    const friendKey=room.code+room.members.map(p=>p.id).join(',');
    if(lobby&&friendRoom!==friendKey){friendRoom=friendKey;friends();}
    const reportKey=room.members.map(m=>m.id).join(',');
    if(room.phase==='result'&&lastReport!==reportKey) {
      lastReport=reportKey;
      $('mpReportPlayer').replaceChildren(...room.members.filter(m=>m.id!==room.me).map(m=>new Option(m.name,m.id)));
    }
    if(!playing)renderChat(room.chat,'mpChat');
    startPreview();
  }
  function listEntry(container,items,empty,format) {
    $(container).replaceChildren(...(items.length?items.map(format):[node('li',empty,'mp-empty')]));
  }
  function listRow(primary,secondary,label,handler) {
    const row=node('li'),text=node('div');
    text.append(node('strong',primary),node('small',secondary));
    row.append(text);
    if(handler)row.append(button(label,handler));
    return row;
  }
  function statPanel(stats) {
    $('mpPersonal').replaceChildren(...['survivor','granny'].map(kind=>{
      const s=stats.find(v=>v.role===kind)??{};
      const card=node('section',undefined,'mp-record');
      card.append(node('h4',role(kind)));
      const fields=kind==='granny'?
        [['Matches',s.games],['Captures',s.captures],['Victories',s.wins],['Win rate',percent(s.wins,s.games)],['Avg. capture time',s.captureTime?time(s.captureTime):'—'],['Points',s.score]]:
        [['Matches',s.games],['Escapes',s.escapes],['Escape rate',percent(s.escapes,s.games)],['Rescues',s.rescues],['Objectives',s.objectives],['Avg. survival',s.survival?time(s.survival):'—'],['Points',s.score]];
      const list=node('dl');
      for(const [label,value] of fields)list.append(node('dt',label),node('dd',String(value??0)));
      card.append(list);return card;
    }));
  }
  async function directory(silent=false) {
    if(room||!isOpen('multiplayer')||loading)return;
    loading=true;lastDirectory=Date.now();
    try {
      const data=await api(base,{retry:false});
      if(!isOpen('multiplayer')||room)return;
      $('mpGate').hidden=true;$('mpDirectory').hidden=false;$('mpRoom').hidden=true;
      $('mpResumeSeat').hidden=!data.resume;
      $('mpResumeSeat').onclick=()=>{if(data.resume)join(data.resume);};
      put('mpIntro','Escape together, or take the Caretaker’s place.');
      listEntry('mpPublic',data.rooms,'No public rooms are waiting.',r=>listRow(r.host,title(r.mode)+' · '+r.seats+'/'+r.capacity+' players','Join',()=>join(r.code)));
      listEntry('mpInvites',data.invites,'No pending invitations.',r=>listRow(r.username,'Room '+r.code,'Join',()=>join(r.code)));
      statPanel(data.stats);
      if(!silent)message();
    }catch(e) {
      if(e.status===401){$('mpGate').hidden=false;$('mpDirectory').hidden=true;if(!silent)message();}
      else if(!silent)message(e.message,true);
    }finally{loading=false;}
  }
  async function rankings() {
    const request=++lastBoard,kind=$('mpBoardRole').value;
    $('mpBoard').replaceChildren(node('li','Loading standings…','mp-empty'));
    try {
      const {rows}=await api(base+'/rankings?role='+kind);
      if(request!==lastBoard)return;
      listEntry('mpBoard',rows,'No competitive records for this role yet.',r=>listRow(r.username,r.wins+' victories · '+r.rankedGames+' ranked matches'));
      for(const [i,row] of [...$('mpBoard').children].entries())if(rows.length)row.append(node('span','#'+(i+1)+' · '+rows[i].score+' pts','mp-chip'));
    }catch(e){if(request===lastBoard)$('mpBoard').replaceChildren(node('li',e.message,'mp-empty'));}
  }
  async function action(data) {
    if(busy)return false;
    busy=true;message();
    try {
      const result=await rq(data.op,data);
      if(data.op==='leave') {
        clearSeat();$('mpDirectory').hidden=false;await directory();
      } else renderRoom(result);
      return true;
    }catch(e){message(e.message,true);return false;}
    finally{busy=false;}
  }
  async function join(code) {
    const clean=code.toUpperCase().trim();
    if(!roomCode.test(clean)){message('Enter a valid six-character room code.',true);return;}
    if(room&&room.code!==clean)await action({op:'leave'});
    if(!room)await action({op:'join',code:clean});
  }
  async function friends() {
    const code=room?.code;
    $('mpFriendList').replaceChildren(node('p','Loading friends…','mp-empty'));
    try {
      const {friends}=await api('friends');
      if(code!==room?.code)return;
      const available=friends.filter(f=>f.relationship==='accepted'&&!room.members.some(m=>m.id===f.id));
      $('mpFriendList').replaceChildren(...(available.length?available.map(f=>listRow(f.username,'Accepted friend','Invite',()=>invite(f.id))):
        [node('p','Add a friend or share your room code.','mp-empty')]));
    }catch(e){if(code===room?.code)$('mpFriendList').replaceChildren(node('p',e.message,'mp-empty'));}
  }
  async function invite(target) {
    if(!room||room.phase!=='lobby')return false;
    const ok=await action({op:'invite',target});
    if(ok)message('Invitation sent.');
    return ok;
  }
  async function refreshRoom() {
    if(busy||loading||!room||!isOpen('multiplayer'))return;
    const code=room.code;loading=true;
    try {
      const next=await post(base+'/'+code,{op:'touch'});
      if(room?.code===code&&!busy&&isOpen('multiplayer'))renderRoom(next);
    }catch(e) {
      if([401,403,404,409].includes(e.status)&&room?.code===code) {
        clearSeat();message(e.message,true);
      }
    }finally{loading=false;}
  }
  async function open() {
    const generation=++opening;
    checkAccount();
    await social.session();
    if(!isOpen('multiplayer')||generation!==opening)return;
    checkAccount();
    if(!online()) {
      $('mpGate').hidden=!navigator.onLine;$('mpDirectory').hidden=true;$('mpRoom').hidden=true;
      message(navigator.onLine?'':'You’re offline. Reconnect to join a room or return to your match.',!navigator.onLine);
      return;
    }
    $('mpGate').hidden=true;
    if(room&&pending&&pending!==room.code) {
      const code=pending;pending='';
      await join(code);
      if(room)return;
    }
    if(room){renderRoom(room);refreshRoom();return;}
    if(pending) {
      const code=pending;pending='';
      await join(code);
      if(room)return;
      remember('');
    }
    await directory();
  }
  async function leave() {
    if(!room){navigate('multiplayer');return;}
    if(!isOpen('multiplayer'))navigate('multiplayer');
    await action({op:'leave'});
  }
  async function complete(result) {
    packet=result;
    if(room) {
      room={...room,phase:'result',winner:result.winner,reason:result.reason,ranked:result.ranked,
        members:room.members.map(m=>({...m,...result.roster.find(p=>p.id===m.id)}))};
    }
    navigate('multiplayer');
  }
  function closed(text) {
    clearSeat();
    currentGame()?.closeMatch();
    navigate('multiplayer');message(text,true);
  }
  function selectTab(records) {
    $('mpRooms').hidden=records;$('mpRecords').hidden=!records;
    $('mpRoomsTab').setAttribute('aria-pressed',String(!records));
    $('mpRecordsTab').setAttribute('aria-pressed',String(records));
    if(records){directory(true);rankings();}
  }
  $('mpMode').onchange=()=>put('mpModeDetail',$('mpMode').value==='pvp'?'One Caretaker. Up to four Survivors.':'Two to four Survivors against the house’s Caretaker.');
  $('mpCreate').onsubmit=e=>{e.preventDefault();action({op:'create',...formSettings()});};
  $('mpEdit').onsubmit=e=>{e.preventDefault();action({op:'settings',...formSettings(true)});};
  $('mpJoin').onsubmit=e=>{e.preventDefault();join($('mpCode').value);};
  $('mpQuick').onclick=()=>action({op:'quick',mode:$('mpMode').value});
  $('mpReady').onclick=()=>action({op:'ready',preference:$('mpRole').value,ready:!room.members.find(p=>p.id===room.me)?.ready});
  $('mpRole').onchange=()=>action({op:'ready',preference:$('mpRole').value,ready:false});
  $('mpStart').onclick=()=>action({op:'start'});
  $('mpQueue').onclick=()=>action({op:'queue'});
  $('mpRematch').onclick=()=>action({op:'rematch'});
  $('mpLeave').onclick=leave;
  $('mpCopy').onclick=async()=>{
    try {
      const link=new URL(location.pathname,location.origin);
      link.searchParams.set('room',room.code);
      await navigator.clipboard.writeText(link.href);message('Invite link copied.');
    }catch{message('Share this room code: '+room.code);}
  };
  $('mpRefresh').onclick=()=>directory();
  $('mpRoomsTab').onclick=()=>selectTab(false);
  $('mpRecordsTab').onclick=()=>selectTab(true);
  $('mpRecordsRefresh').onclick=()=>{directory();rankings();};
  $('mpBoardRole').onchange=rankings;
  $('mpChatForm').onsubmit=async e=>{
    e.preventDefault();const input=$('mpChatText');
    if(await action({op:'chat',text:input.value}))input.value='';
  };
  $('mpReport').onsubmit=async e=>{
    e.preventDefault();
    if(await action({op:'report',target:$('mpReportPlayer').value,reason:$('mpReportReason').value}))message('Report received.');
  };
  $('mpEnter').onclick=async()=>{
    if(room?.phase!=='play')return;
    const target=room.game;
    $('mpEnter').disabled=true;
    if(preview){preview.dispose();preview=null;}
    const match=await game();
    $('mpEnter').disabled=false;
    if(!match||room?.game!==target||!isOpen('multiplayer'))return;
    voice=room.voice?proximityVoice(room,(text,enabled)=>{
      put('mpVoiceStatus',text);put('mpVoiceToggle',enabled?'Disable microphone':'Enable microphone');
      $('mpHudVoice').hidden=$('mpTalk').hidden=!enabled;
    },id=>muted.has(id)):null;
    $('mpVoiceConsent').open=false;
    match.beginMatch(transport(room,complete,leave,closed,voice));
  };
  $('mpVoiceToggle').onclick=()=>voice?.toggle();
  $('mpPreview').onpointerdown=e=>{
    const origin=e.clientX;
    $('mpPreview').setPointerCapture(e.pointerId);
    $('mpPreview').onpointermove=event=>{angle+=(event.clientX-origin)*.0008;};
  };
  $('mpPreview').onlostpointercapture=()=>{$('mpPreview').onpointermove=null;};
  $('mpTeamChat').onclick=()=>{navigate('teamChat');refreshTeam();};
  $('mpTeamForm').onsubmit=async e=>{
    e.preventDefault();const input=$('mpTeamText');
    if(!room)return;
    try {
      const result=await rq('chat',{text:input.value});
      input.value='';renderChat(result.chat,'mpTeamMessages');put('mpTeamError','');
    }catch(e){put('mpTeamError',e.message);}
  };
  $('mpSpectateNext').onclick=async()=>{
    if(!room||!packet)return;
    const eligible=packet.roster.filter(p=>p.role==='survivor'&&p.status==='active');
    const next=eligible[(eligible.findIndex(p=>p.name===packet.watch?.name)+1)%eligible.length];
    if(next)try{await rq('spectate',{target:next.id});currentGame()?.resume();}catch(e){put('mpTeamError',e.message);}
  };
  async function refreshTeam() {
    if(!room||!isOpen('teamChat'))return;
    try {const r=await rq('touch');if(isOpen('teamChat'))renderChat(r.chat,'mpTeamMessages');}
    catch(e){put('mpTeamError',e.message);}
  }
  setInterval(()=>{
    if(document.hidden)return;
    if(isOpen('multiplayer')){
      if(room)refreshRoom();else if(online()&&Date.now()-lastDirectory>7900)directory(true);
    } else if(isOpen('teamChat'))refreshTeam();
  },1250);

  return {open,invite,joinFriend(code){pending=code;navigate('multiplayer');},hasInvite:Boolean(roomCode.test(inviteCode??'')),
    get canInvite(){return room?.phase==='lobby';},
    hud(next) {
      packet=next;
      $('mpHud').hidden=!next;$('mpPauseDetail').hidden=!next;
      put('pauseTitle',next?'Match menu':'Paused');put('pauseLeave',next?'Leave match':'Abandon run');
      $('mpTeamChat').hidden=!(next?.me.role==='survivor'&&next.me.status==='active');
      $('mpSpectateNext').hidden=!next?.watch;
      $('mpVoiceConsent').hidden=!(next?.voice&&next.me.status==='active');
      const hunter=next?.me.role==='granny';
      for(const b of document.querySelectorAll('[data-granny]'))b.hidden=!hunter;
      for(const b of document.querySelectorAll('[data-touch="KeyG"],[data-touch="KeyC"],[data-touch="ShiftLeft"]'))b.hidden=Boolean(hunter);
      if(!next){this.connection('');return;}
      put('hudDay',next.difficulty==='nightmare'?'NIGHTMARE':next.mode==='pvp'?'PVP MATCH':'CO-OP MATCH');
      put('mpHudRole',hunter?'GRANNY':'SURVIVOR');
      put('mpHudTime',time(Math.max(0,Math.ceil((next.deadline-next.clock)/1000))));
      const survivors=next.roster.filter(p=>p.role==='survivor');
      put('mpHudTeam',survivors.filter(p=>p.status==='active').length+' active · '+survivors.filter(p=>p.status==='escaped').length+' escaped');
      const seconds=until=>Math.max(0,Math.ceil((until-next.clock)/1000));
      put('mpHudStatus',next.watch?'Spectating '+next.watch.name:
        next.me.status==='captured'?'Captured · rescue window '+seconds(next.timers.down)+'s':
        next.me.status==='escaped'?'You escaped. Waiting for the others.':
        next.me.status==='eliminated'?'Eliminated · waiting for the result.':
        hunter&&seconds(next.timers.warm)?'The hunt starts in '+seconds(next.timers.warm)+'s':'');
      const label=key=>seconds(next.timers[key])?seconds(next.timers[key])+'s':'ready';
      put('mpHudAbilities',hunter?'E  Swing '+label('attack')+'   Q  Snare '+label('trap')+'   X  Bolt '+label('bolt'):'');
    },
    connection(text){put('mpConnection',text);$('mpConnection').hidden=!text;}
  };
}
