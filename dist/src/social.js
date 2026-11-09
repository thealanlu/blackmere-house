import {api} from './online.js';

const $=id=>document.getElementById(id);
const el=(tag,text,cls)=>{
  const node=document.createElement(tag);
  if(text!==undefined)node.textContent=text;
  if(cls)node.className=cls;
  return node;
};
const msg=(id,text='',error=false)=>{$(id).textContent=text;$(id).toggleAttribute('data-error',error);};
const savedSession={
  get(){try{return localStorage.getItem('blackmere.passwordSession')==='1';}catch{return false;}},
  set(on){try{if(on)localStorage.setItem('blackmere.passwordSession','1');else localStorage.removeItem('blackmere.passwordSession');}catch{}}
};
const fmt=n=>new Intl.NumberFormat().format(n??0);
export function timeLabel(ticks){
  if(!ticks)return '—';
  const seconds=ticks/30;
  return Math.floor(seconds/60)+':'+(seconds%60).toFixed(2).padStart(5,'0');
}
const percentage=(wins,games)=>games?Math.round(wins/games*100)+'%':'—';
const control=(text,fn)=>{const b=el('button',text,'text-button');b.type='button';b.onclick=fn;return b;};
function avatar(p) {
  if(!p.avatar)return el('span',p.username[0].toUpperCase(),'avatar');
  const img=el('img',undefined,'avatar');img.alt='';img.width=29;img.height=29;
  img.src='/api/avatar/'+encodeURIComponent(p.id);
  img.onerror=()=>img.replaceWith(el('span',p.username[0].toUpperCase(),'avatar'));
  return img;
}
async function asAvatar(file) {
  if(!/^image\/(png|jpeg|webp)$/.test(file.type)||file.size>6e6)throw new Error('Choose a PNG, JPG or WebP under 6 MB.');
  const bitmap=await createImageBitmap(file),c=el('canvas');
  c.width=c.height=144;
  const size=Math.min(bitmap.width,bitmap.height);
  c.getContext('2d').drawImage(bitmap,(bitmap.width-size)/2,(bitmap.height-size)/2,size,size,0,0,144,144);
  bitmap.close();
  return c.toDataURL('image/webp',.83);
}

export function bindSocial(navigate,isOpen) {
  let current={},config={},authMode='login',avatarPatch,profileTarget=null,page=1,pages=1,boardRequest=0,friendRequest=0;
  let online=false;
  function badge(count) {
    $('notificationBadge').hidden=!count;
    $('notificationBadge').textContent=count>99?'99+':count||'';
  }
  async function session() {
    try{
      current=await api('me');
      if(!current.user&&savedSession.get()&&config.passwordAccounts){
        const r=await api('auth/refresh',{method:'POST',retry:false}).catch(()=>null);
        if(r?.signedIn)current=await api('me',{retry:false});
        else savedSession.set(false);
      }
      online=true;
    }catch{current={};online=false;}
    $('accountMenu').textContent=current.profile?'Account':'Log in / Sign up';
    badge(current.notifications);
    return current;
  }
  function signIn(){authMode='login';navigate('auth');}
  function showAuth(next=authMode,preserveStatus=false) {
    authMode=next;
    if(!preserveStatus)msg('authStatus');
    const signed=current.user?.provider==='supabase';
    const native=current.user?.provider==='chatgpt';
    const form=Boolean(config.passwordAccounts&&!signed);
    $('authTabs').hidden=!form;
    $('authForm').hidden=!form;
    $('accountLogout').hidden=!signed&&!native;
    $('nativeSignIn').hidden=!config.chatgpt||native||signed;
    $('authPassword').minLength=next==='login'?1:10;
    $('authPassword').autocomplete=next==='login'?'current-password':'new-password';
    $('authPassword').value='';
    const text=next==='signup'?'Create account':'Log in';
    $('authTitle').textContent=signed?'Your account':text;
    $('authSubmit').firstElementChild.textContent=text;
    $('authIntro').textContent=signed?'You’re signed in. Open My Profile to edit your player details.':
      !form?'Player accounts are unavailable on this host. Guest play is available.':
      next==='signup'?'Choose a gamer tag and password. Save your password somewhere safe.':
      'Sign in with your gamer tag and password.';
    for(const b of document.querySelectorAll('.auth-tabs [data-auth-mode]'))b.toggleAttribute('aria-current',b.dataset.authMode===next);
  }
  for(const b of document.querySelectorAll('[data-auth-mode]'))b.addEventListener('click',()=>showAuth(b.dataset.authMode));
  $('authForm').addEventListener('submit',async e=>{
    e.preventDefault();
    const mode=authMode,button=$('authSubmit');
    button.disabled=true;msg('authStatus','Working…');
    const d={password:$('authPassword').value,username:$('authName').value};
    try {
      await api('auth/'+mode,{method:'POST',data:d});
      savedSession.set(true);await session();profileTarget=null;navigate('profile');
    }catch(error){msg('authStatus',error.message,true);}
    finally {button.disabled=false;$('authPassword').value='';}
  });
  $('accountLogout').onclick=async()=>{
    const b=$('accountLogout');b.disabled=true;
    try {
      if(current.user?.provider==='chatgpt') {
        window.open('/signout-with-chatgpt?returnTo=%2F','_top');return;
      }
      await api('auth/logout',{method:'POST'});
      savedSession.set(false);
      await session();showAuth('login');msg('authStatus','Signed out of your player account.');
    }catch(e){msg('authStatus',e.message,true);}
    finally{b.disabled=false;}
  };
  async function initialize() {
    try{config=await api('config');}catch{}
    await session();if(isOpen('auth'))showAuth(authMode,true);
  }

  function playerName(p,click=true) {
    const row=el('span',undefined,'player-name');
    row.append(avatar(p),click?control(p.username,()=>openProfile(p.id)):el('span',p.username));return row;
  }
  function openProfile(id) {
    profileTarget=id;navigate('profile');
  }
  async function fetchBoard({silent=false}={}) {
    const request=++boardRequest;
    if(!silent)msg('boardStatus','Loading verified records…');
    const p=new URLSearchParams({metric:$('boardMetric').value,period:$('boardPeriod').value,scope:$('boardScope').value,q:$('boardSearch').value,page});
    try{
      const r=await api('leaderboard?'+p);
      if(request!==boardRequest||!isOpen('leaderboards'))return;
      page=r.page;pages=r.pages;
      const rows=r.results.map(p=>{
        const row=el('tr');
        row.classList.toggle('podium',p.rank<=3);
        row.classList.toggle('current',p.id===current.profile?.id);
        const name=el('td');name.append(playerName(p));
        row.append(el('td','#'+p.rank),name,el('td',fmt(p.score)),el('td',fmt(p.escapes)),el('td',timeLabel(p.best)),el('td',percentage(p.escapes,p.games)));
        return row;
      });
      $('rankRows').replaceChildren(...rows);
      $('boardPage').textContent='PAGE '+page+' OF '+pages;
      $('boardPrevious').disabled=page<=1;$('boardNext').disabled=page>=pages;
      const personal=$('personalBest');
      personal.hidden=!current.profile;
      personal.textContent=r.personal?'Your rank #'+r.personal.rank+' · '+fmt(r.personal.score)+' points · Best escape '+timeLabel(r.personal.best):
        'Your profile has no qualifying result in this view.';
      msg('boardStatus',rows.length?'':r.metric==='rate'?'No players have five verified games in this view.':'No verified results match this view.');
    }catch(error){
      if(request!==boardRequest)return;
      $('rankRows').replaceChildren();$('personalBest').hidden=true;
      $('boardPage').textContent='';$('boardPrevious').disabled=$('boardNext').disabled=true;
      msg('boardStatus',error.message,true);
    }
  }
  $('boardFilters').onsubmit=e=>{e.preventDefault();page=1;fetchBoard();};
  for(const id of ['boardMetric','boardPeriod','boardScope'])$(id).onchange=()=>{page=1;fetchBoard();};
  $('boardPrevious').onclick=()=>{if(page>1){page--;fetchBoard();}};
  $('boardNext').onclick=()=>{if(page<pages){page++;fetchBoard();}};

  function record(p,s,rank,recent=[]) {
    const hero=el('div',undefined,'profile-hero'),label=el('div');
    label.append(el('strong',p.username),el('small','Registered '+new Date(p.createdAt).toLocaleDateString()));
    hero.append(avatar(p),label);
    const stats=el('dl',undefined,'profile-stats');
    const cards=[['Global rank',rank?'#'+rank:'—'],['Verified games',fmt(s.games)],['Escapes',fmt(s.escapes)],['Deaths',fmt(s.deaths)],
      ['Escape rate',percentage(s.escapes,s.games)],['Fastest escape',timeLabel(s.best)],['Total score',fmt(s.score)]];
    for(const [name,value] of cards){const d=el('div');d.append(el('dt',name),el('dd',value));stats.append(d);}
    $('profileRecord').replaceChildren(hero,stats);
    if(recent.length) {
      const history=el('details',undefined,'scoring');history.append(el('summary','Recent ranked runs'));
      for(const r of recent)history.append(el('p',new Date(r.finished_at).toLocaleDateString()+' · '+(r.route?'Escaped in '+timeLabel(r.ticks)+' · '+fmt(r.score)+' pts':'Caught on night five')));
      $('profileRecord').append(history);
    }
    $('profileRecord').hidden=false;
  }
  async function renderProfile() {
    const target=profileTarget;
    $('profileTitle').textContent=target?'Player Profile':'My Profile';
    $('profileForm').hidden=$('deleteAccount').hidden=$('profileRecord').hidden=$('profileSignIn').hidden=true;
    avatarPatch=undefined;$('avatarFile').value='';msg('profileStatus','Loading player record…');
    try {
      const r=target?await api('profile/'+encodeURIComponent(target)):await session();
      if(!isOpen('profile')||profileTarget!==target)return;
      if(!target&&!online)throw new Error('Player services are unavailable.');
      msg('profileStatus');
      if(r.profile)record(r.profile,r.stats,r.rank,r.recent);
      if(target)return;
      if(!r.user){$('profileSignIn').hidden=false;return msg('profileStatus','Sign in to create a player record.');}
      $('profileForm').hidden=false;
      $('profilePrivacy').hidden=$('deleteAccount').hidden=!r.profile;
      $('profileFormTitle').textContent=r.profile?'Profile settings':'Choose your username';
      $('saveProfile').textContent=r.profile?'Save profile':'Create profile';
      $('profileName').value=r.profile?.username??r.user.username??'';
      $('visibility').value=r.profile?.visibility??'public';$('allowRequests').checked=r.profile?.allowRequests??true;
    }catch(e){msg('profileStatus',e.message,true);}
  }
  $('profileSignIn').onclick=signIn;$('friendsSignIn').onclick=signIn;
  $('profileForm').onsubmit=async e=>{
    e.preventDefault();const b=$('saveProfile');b.disabled=true;
    try {
      const file=$('avatarFile').files[0];
      const payload={username:$('profileName').value,visibility:$('visibility').value,allowRequests:$('allowRequests').checked};
      if(file)payload.avatar=await asAvatar(file);
      else if(avatarPatch!==undefined)payload.avatar=avatarPatch;
      await api('profile',{method:current.profile?'PATCH':'POST',data:payload});
      await renderProfile();msg('profileStatus','Profile saved.');
    }catch(e){msg('profileStatus',e.message,true);}
    finally{b.disabled=false;}
  };
  $('clearAvatar').onclick=()=>{avatarPatch=null;$('avatarFile').value='';msg('profileStatus','Profile picture will be removed when you save.');};
  $('deleteForm').onsubmit=async e=>{
    e.preventDefault();const b=e.submitter;b.disabled=true;
    try {
      await api('profile',{method:'DELETE',data:{confirm:$('deleteConfirm').value}});
      $('deleteConfirm').value='';savedSession.set(false);
      await renderProfile();msg('profileStatus','Your player account was deleted.');
    }catch(e){msg('profileStatus',e.message,true);}
    finally{b.disabled=false;}
  };

  function actions(p) {
    if(p.relationship==='accepted')return [['Remove','remove'],['Block','block']];
    if(p.relationship==='pending')return p.outgoing?[['Cancel','cancel'],['Block','block']]:[['Accept','accept'],['Decline','decline'],['Block','block']];
    return [['Send request','send'],['Block','block']];
  }
  function rows(id,players,empty,blocked=false) {
    $(id).replaceChildren(...(players.length?players.map(p=>{
      const row=el('div',undefined,'player-row'),buttons=el('span',undefined,'player-actions');
      row.append(playerName(p,!blocked));
      for(const [label,action] of blocked?[['Unblock','unblock']]:actions(p)) {
        const button=control(label,()=>friendAction(p.id,action,button));buttons.append(button);
      }
      row.append(buttons);return row;
    }):[el('p',empty)]));
  }
  async function renderFriends({silent=false}={}) {
    const request=++friendRequest;
    if(!silent)msg('friendsStatus','Loading friends…');
    try {
      if(!silent)await session();
      if(!isOpen('friends')||request!==friendRequest)return;
      $('friendsSignIn').hidden=Boolean(current.profile);
      $('friendsSignIn').textContent=current.user?'Create profile':'Log in / Sign up';
      $('friendsSignIn').onclick=current.user?()=>{profileTarget=null;navigate('profile');}:signIn;
      $('friendsContent').hidden=!current.profile;
      if(!current.profile)return msg('friendsStatus',online?'A player profile is required to connect with friends.':'Player services are unavailable.');
      const data=await api('friends');
      if(!isOpen('friends')||request!==friendRequest)return;
      rows('requestsList',data.friends.filter(p=>p.relationship==='pending'),'No pending requests.');
      rows('friendsList',data.friends.filter(p=>p.relationship==='accepted'),'No friends added yet.');
      rows('blocksList',data.blocks,'No blocked players.',true);
      $('friendNotes').replaceChildren(...data.notifications.map(n=>el('p',(n.seen?'':'• ')+n.username+(n.kind==='request'?' sent a request.':' accepted your request.'))));
      $('markNotes').disabled=!data.notifications.some(n=>!n.seen);
      badge(data.notifications.filter(n=>!n.seen).length);
      msg('friendsStatus');
    }catch(e){if(request===friendRequest)msg('friendsStatus',e.message,true);}
  }
  async function find() {
    try{
      const r=await api('players?q='+encodeURIComponent($('findQuery').value));
      rows('searchPlayers',r.players,'No public profiles match that username.');
    }catch(e){msg('friendsStatus',e.message,true);}
  }
  $('findPlayers').onsubmit=e=>{e.preventDefault();find();};
  async function friendAction(target,action,button) {
    button.disabled=true;
    try{await api('friends',{method:'POST',data:{target,action}});await renderFriends();if($('findQuery').value.length>=2)await find();}
    catch(e){msg('friendsStatus',e.message,true);}
    finally{button.disabled=false;}
  }
  $('markNotes').onclick=async()=>{
    try{await api('notifications',{method:'POST'});await renderFriends();}
    catch(e){msg('friendsStatus',e.message,true);}
  };
  $('friendBoard').onclick=()=>{$('boardScope').value='friends';navigate('leaderboards');};
  setInterval(()=>{
    if(document.hidden)return;
    if(isOpen('leaderboards'))fetchBoard({silent:true});
    else if(isOpen('friends')&&current.profile)renderFriends({silent:true});
    else if(isOpen('menu')&&current.profile)session();
  },15000);

  return {initialize,session,
    open(name,own=false) {
      if(name==='auth'){showAuth();session().then(()=>{if(isOpen('auth')&&!$('authName').value)showAuth(authMode,true);});}
      if(name==='profile'){if(own)profileTarget=null;renderProfile();}
      if(name==='leaderboards'){page=1;fetchBoard();}
      if(name==='friends'){renderFriends();}
    },
    afterResult(){session();},
    get profile(){return current.profile;},get user(){return current.user;},get online(){return online;}
  };
}
