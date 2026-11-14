import { itemInfo, levels, hasMap, areaAt } from './rules.js';
import {readLocal,writeLocal} from './local-progress.js';
import {readRecord,recordResult,syncRecords} from './solo-record.js';
import { rankedAttempt,api } from './online.js';
import { bindSocial, timeLabel } from './social.js';
import { bindMultiplayer } from './multiplayer.js';
import { createAudio } from './audio.js';
import { normalizePreferences } from './preferences.js';
import { bindDevices } from './device-ui.js';
import { deviceData } from './device-data.js';
import { requestGyro } from './input.js';
import { configurePwa } from './pwa.js';

const $=id=>document.getElementById(id);
const saved=await readLocal('settings')??{};
const settings=normalizePreferences(saved,matchMedia('(prefers-reduced-motion: reduce)').matches);
const screens=[...document.querySelectorAll('.screen')];
const menuDialogs=new Map([...document.querySelectorAll('.menu-dialog')].map(dialog=>[dialog.id,dialog]));
let view='menu',returnView='menu',dialogOrigin,game,gameModule,initializing,toastTimer,revealTimer,footstepTimer,footstepPulse;
let threatLabel='',lastPrompt='',gyroAllowed=false,accountId=null,runOwner=null,continueSave,guestSave,comparison,comparisonOwner,continueRequest=0,saveInFlight=false;
const guestOnly=document.documentElement.dataset.edition==='guest';
try{if(!guestOnly)accountId=localStorage.getItem('blackmere.deviceAccount');}catch{}
const sound=createAudio();
const devices=bindDevices(settings,{view:()=>view,back,controlHint:kind=>{
  $('prompt').firstElementChild.textContent=kind==='pad'?'A':'E';
  if(kind!=='mouse')$('mouseHint').hidden=true;
}});
const sync=deviceData(patch=>{Object.assign(settings,patch);persistSettings();updateOptions();game?.configure();},
  status=>{$('preferenceStatus').textContent=status;});
const social=guestOnly?null:bindSocial(navigate,name=>view===name);
const multiplayer=guestOnly?null:bindMultiplayer({navigate,isOpen:name=>view===name,social,game:createGameOnce,currentGame:()=>game});
social?.setMultiplayer(multiplayer);
social?.setAccountListener((id,reachable)=>{
  if(!reachable)return;
  const changed=id!==accountId;
  accountId=id;sync.account(id);
  try{if(id)localStorage.setItem('blackmere.deviceAccount',id);else localStorage.removeItem('blackmere.deviceAccount');}catch{}
  if(changed&&view==='dispatch')loadContinue();
  if(changed&&view==='offlineRecord')loadRecord();
});
function warmGame() {
  gameModule??=import('./game.js').catch(error=>{gameModule=null;throw error;});
  return gameModule;
}
function fatal(error) {
  console.error(error);
  $('graphicsErrorText').textContent=error.message==='WebGL context lost'?
    'The browser interrupted the 3D view. Wait a moment, then retry with Low graphics.':
    'This game needs WebGL 2. Try Low graphics or a browser with hardware acceleration enabled. The menus are still available.';
  $('fatal').hidden=false;$('graphicsRetry').focus({preventScroll:true});
}
function createGameOnce() {
  sound.init();
  if(settings.gyro&&!gyroAllowed)enableGyro();
  if(game)return Promise.resolve(game);
  initializing??=warmGame().then(({createGame})=>{
    game=createGame($('game'),ui,settings,sound);
    game.gyro.allow(gyroAllowed);
    return game;
  }).catch(error=>{fatal(error);return null;}).finally(()=>{initializing=null;});
  return initializing;
}
async function enableGyro() {
  gyroAllowed=await requestGyro();
  if(!settings.gyro)return;
  game?.gyro.allow(gyroAllowed);
  $('motionStatus').textContent=gyroAllowed?'Gyroscope aim is enabled when using touch.':'Motion access is unavailable. You can still drag to look.';
}
function persistSettings(){writeLocal('settings',{...settings,updated:Date.now()});}
function updateOptions() {
  for(const [key,value] of Object.entries(settings)) {
    const input=$(key);
    if(input.type==='checkbox')input.checked=value;
    else input.value=value;
    const output=$(key+'Value');
    if(output)output.textContent=key==='joystickInset'||key==='joystickHeight'?value+' px':Math.round(value*100)+'%';
  }
  $('playDifficulty').value=settings.difficulty;
  $('levelDescription').textContent=levels[settings.difficulty].caption;
  devices.apply();
}
updateOptions();
for(const key of Object.keys(settings)) {
  $(key).addEventListener('input',e=>{
    const input=e.target;
    settings[key]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    if(key==='gyro') {
      if(settings.gyro)enableGyro();
      else {gyroAllowed=false;game?.gyro.disable();$('motionStatus').textContent='';}
    }
    persistSettings();sync.change(key,settings[key]);
    updateOptions();game?.configure();
  });
}
function switchTo(name) {
  const previous=menuDialogs.get(view),dialog=menuDialogs.get(name);
  if(previous&&previous!==dialog)previous.close();
  view=name;
  if(name!=='play') {
    clearTimeout(footstepTimer);footstepPulse?.cancel();$('footstepCue').hidden=true;
  }
  const display=dialog?returnView:name==='play'?'playHud':['victory','interlude','defeat'].includes(name)?'result':name;
  for(const screen of screens)screen.hidden=screen.id!==display;
  devices.rotation();
  $('saveSolo').hidden=name!=='pause'||!game?.checkpoint();
  if(name==='pause')$('saveStatus').textContent='';
  if(name!=='caught')$('gameShade').classList.remove('caught');
  if(dialog) {
    if(!dialog.open){
      dialog.scrollTop=0;
      dialog.showModal();
      $(dialog.getAttribute('aria-labelledby')).focus({preventScroll:true});
    }
    return;
  }
  if(name==='play')$('game').focus({preventScroll:true});
  else if(previous&&dialogOrigin?.getClientRects().length)dialogOrigin.focus({preventScroll:true});
  else if(name!=='menu'&&name!=='caught')$(display)?.querySelector('button')?.focus({preventScroll:true});
  dialogOrigin=null;
}
$('game').tabIndex=-1;
$('game').addEventListener('webglcontextlost',event=>{
  event.preventDefault();game?.pause();fatal(new Error('WebGL context lost'));
});
$('game').addEventListener('webglcontextrestored',()=>{$('fatal').hidden=true;game?.configure();});
$('graphicsDismiss').onclick=()=>{$('fatal').hidden=true;};
$('graphicsRetry').onclick=()=>{
  settings.graphics='low';settings.frameRate='30';persistSettings();updateOptions();$('fatal').hidden=true;
  if(game){game.configure();game.resume();}
  else if(view==='dispatch')$('guestPlay').click();
  else if(view==='multiplayer')$('mpEnter').click();
};
function result(mode,{route,day,ranked}) {
  const night='NIGHT '+String(day).padStart(2,'0')+' / 05';
  $('resultLabel').textContent=mode==='victory'?'ESCAPE RECORDED / '+night:night;
  const button=$('resultNext');
  $('rankResult').textContent=ranked?'Verifying the run…':'';
  if(mode==='interlude') {
    $('resultTitle').textContent='She found you.';
    $('resultText').textContent='You wake in the same room. What you found is still yours. Keep moving.';
    button.firstElementChild.textContent='Wake on night '+(day+1);
    button.onclick=()=>game.nextNight();
  }else if(mode==='defeat') {
    $('resultTitle').textContent='The house kept you.';
    $('resultText').textContent='The fifth night ended before you reached an exit.';
    button.firstElementChild.textContent='Start again';
    button.onclick=()=>{game.menu();navigate('dispatch');};
  }else {
    $('resultTitle').textContent=route==='front'?'First Light':'Beneath the House';
    $('resultText').textContent=route==='front'
      ?'You crossed the threshold as dawn reached the grounds. Behind you, the front door shut.'
      :'The drain carried you beyond the grounds. Under the bridge, you heard one last footstep above you.';
    button.firstElementChild.textContent='Play again';
    button.onclick=()=>{game.menu();navigate('dispatch');};
  }
}
const rows=[
  ['The Front Door',[['cut','Sever the door chain',itemInfo.cutters.hint],['unlock','Unlock the brass lock',itemInfo.key.hint]]],
  ['The Storm Drain',[['power','Restore power in the cellar',itemInfo.fuse.hint],['handle','Fit the handle and open the gate',itemInfo.crank.hint]]]
];
const slots=Array.from({length:4},(_,i)=>{
  const slot=document.createElement('button'), index=document.createElement('small'),label=document.createElement('span');
  slot.className='slot';slot.type='button';slot.tabIndex=-1;slot.dataset.slot=i;index.textContent=i+1;slot.append(index,label);$('inventory').append(slot);return slot;
});

const ui={
  control:devices.mark,controlKind:devices.kind,
  checkpoint(value,replay) {
    sync.local(runOwner,value,replay).then(ok=>{if(!ok)ui.toast('Progress could not be saved. Free up browser storage.');});
  },
  soloResult(result,replay) {recordResult(runOwner,result,replay).then(ok=>{if(!ok)ui.toast('Could not save this result on this device.');});},
  show(mode,data) {
    if(mode==='note'){$('noteTitle').textContent=data.name;$('noteText').textContent=data.body;}
    if(['interlude','victory','defeat'].includes(mode))result(mode,data);
    switchTo(mode);
    if(mode==='caught')$('gameShade').classList.add('caught');
  },
  night(day,title) {
    const label='NIGHT '+String(day).padStart(2,'0')+' / 05';
    for(const id of ['hudDay','chapterLabel','journalNight'])$(id).textContent=label;
    $('chapterName').textContent=title;
    const card=$('nightCard');
    clearTimeout(revealTimer);card.classList.remove('reveal');void card.offsetWidth;card.classList.add('reveal');
    revealTimer=setTimeout(()=>card.classList.remove('reveal'),4850);
    ui.hide(false);ui.prompt('');$('toast').classList.remove('show');
  },
  updateInventory(inv,selected) {
    slots.forEach((slot,i)=>{
      slot.classList.toggle('selected',i===selected);
      slot.lastElementChild.textContent=inv[i]?itemInfo[inv[i].id].mark:'';
      slot.title=inv[i]?.name??'Empty slot';
      slot.setAttribute('aria-label','Slot '+(i+1)+', '+slot.title);
    });
  },
  difficulty(value){
    document.documentElement.dataset.nightmare=String(!hasMap(value));
    $('footstepCue').hidden=true;
  },
  updateObjectives(progress,difficulty) {
    const container=$('objectives');
    container.replaceChildren();
    for(const [route,goals] of rows) {
      const h=document.createElement('h3'),list=document.createElement('ul');
      h.textContent=route;
      const additional=route==='The Front Door'?['spindle','Fit the deadbolt spindle','Search the attic workshop or storage.']:
        ['relay','Fit the drain relay','Search the library and washroom.'];
      const tasks=hasMap(difficulty)?goals:route==='The Front Door'?[goals[0],additional,goals[1]]:[additional,...goals];
      for(const [id,label,hint] of tasks) {
        const row=document.createElement('li'),caption=document.createElement('span');
        row.classList.toggle('done',progress[id]);row.textContent=(progress[id]?'✓  ':'○  ')+label;
        if(!progress[id]){caption.textContent=hasMap(difficulty)?hint:({cut:'Search for bolt cutters.',unlock:'Find the front key.',power:'Find a porcelain fuse.',handle:'Locate the missing winch handle.'}[id]??hint);row.append(caption);}
        list.append(row);
      }
      container.append(h,list);
    }
  },
  stamina(v,sprinting) {$('stamina').style.width=(v*100).toFixed(1)+'%';$('stamina').style.background=sprinting?'#e0a68b':'';},
  threat(state,value) {
    const label=state==='chase'?'RUN':value>.57?'SHE IS CLOSE':'';
    if(label!==threatLabel){threatLabel=label;$('threat').textContent=label;}
  },
  footstep(direction,muffled,label) {
    const cue=$('footstepCue');
    cue.dataset.direction=direction;
    cue.dataset.muffled=String(muffled);
    cue.lastElementChild.textContent=(label??(muffled?'Muffled steps':'Footsteps'))+' · '+direction;
    cue.hidden=false;
    if(settings.motion) {
      footstepPulse?.cancel();
      footstepPulse=cue.animate([{opacity:.55},{opacity:1,offset:.18},{opacity:.88}],{duration:520,easing:'ease-out'});
    }
    clearTimeout(footstepTimer);
    footstepTimer=setTimeout(()=>{cue.hidden=true;},910);
  },
  prompt(text) {
    if(text===lastPrompt)return;
    lastPrompt=text;$('prompt').hidden=!text;$('prompt').lastElementChild.textContent=text;
    $('touchUse').textContent=text||'Use';
    $('reticle').classList.toggle('focus',Boolean(text));
  },
  toast(text){const el=$('toast');clearTimeout(toastTimer);el.textContent=text;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),2750);},
  area(name){$('area').textContent=name;},
  flash(on,charge,spare,hunter){
    const hud=$('batteryHud');
    hud.hidden=hunter;$('touchLight').hidden=hunter;
    if(hunter)return;
    const value=Math.ceil((charge??1)*100);
    const label=value===0?'Empty':value<=10?'Critical':value<=25?'Low':on?'On':'Off';
    const text=value+'% · '+label;
    if($('flashLabel').textContent!==text)$('flashLabel').textContent=text;
    const stock=spare+' spare';
    if($('batterySpare').textContent!==stock)$('batterySpare').textContent=stock;
    hud.dataset.status=value<=10?'critical':value<=25?'low':'normal';
    $('batteryBar').style.width=value+'%';
  },
  mouseHint(show){$('mouseHint').hidden=!show;},
  hide(type){
    const shade=$('gameShade');
    shade.classList.toggle('hide',Boolean(type));
    if(type&&shade.dataset.cover!==type)shade.dataset.cover=type;
    else if(!type&&shade.dataset.cover)delete shade.dataset.cover;
  },
  coverTransition(amount){
    const style=$('gameShade').style,value=amount.toFixed(2);
    if(style.getPropertyValue('--cover-fade')!==value)style.setProperty('--cover-fade',value);
  },
  match(packet){multiplayer?.hud(packet);},
  matchConnection(text){multiplayer?.connection(text);},
  rankResult(data,error) {
    if(data)social?.afterResult();
    if(!['victory','defeat'].includes(view))return;
    $('rankResult').textContent=data?'Verified · '+data.score.toLocaleString()+' points · '+timeLabel(data.ticks):'Run was not recorded. '+error;
  }
};
function navigate(name,own=false) {
  if(menuDialogs.has(name)&&!menuDialogs.has(view)) {
    returnView=['pause','dispatch','multiplayer'].includes(view)?view:'menu';
    dialogOrigin=document.activeElement;
  }
  switchTo(name);
  social?.open(name,own);
  if(name==='multiplayer')multiplayer?.open();
  if(name==='offlineRecord')loadRecord();
  if(name==='dispatch') {
    warmGame().catch(()=>{});
    loadContinue();
    $('playDifficulty').value=settings.difficulty;
    $('playMessage').textContent='';
    if(!social)return;
    const update=()=>{
      $('rankedPlay').firstElementChild.textContent=social.profile?'Ranked run':social.user?'Create a profile to play ranked':'Log in to play ranked';
      $('rankedHelp').textContent=social.profile?'Verified runs count toward your record.':'A player profile is required to record a verified result.';
    };
    update();if(navigator.onLine)social.session().then(update);
  }
}
function back() {
  if(!$('fatal').hidden){$('fatal').hidden=true;return;}
  if(menuDialogs.has(view)) {
    const destination=returnView;
    if(view==='settings')sync.flush();
    switchTo(destination);
    if(destination==='multiplayer')multiplayer?.open();
    if(destination==='dispatch')loadContinue();
  }
  else if(['dispatch','multiplayer'].includes(view))switchTo('menu');
  else if(['journal','note','pause'].includes(view))game?.resume();
}
function setRunDifficulty() {
  settings.difficulty=$('playDifficulty').value;
  $('difficulty').value=settings.difficulty;
  persistSettings();
}
function saveLabel(checkpoint) {
  const {state,difficulty}=checkpoint;
  return 'Night '+state.day+' · '+levels[difficulty].label+' · '+areaAt(state.player.x,state.player.z);
}
async function checkSync(id) {
  if(!id||!navigator.onLine)return null;
  let next=await sync.compare(id);
  const guest=await sync.read(null);
  if(!next?.pending&&!next?.conflict&&guest?.checkpoint&&guest.dirty)next=await sync.compare(id,null);
  return next;
}
async function loadContinue() {
  const generation=++continueRequest,id=accountId;
  const current=()=>generation===continueRequest&&view==='dispatch';
  const display=async()=>{
    const [local,guest]=await Promise.all([sync.read(id),id?sync.read(null):null]);
    if(!current())return;
    continueSave=local;guestSave=guest;
    $('continueSolo').hidden=$('soloDetail').hidden=!local?.checkpoint;
    $('resumeDevice').hidden=!guest?.checkpoint;
    if(local?.checkpoint)$('soloDetail').textContent=saveLabel(local.checkpoint)+' · Unranked';
  };
  await display();
  if(current())$('reviewSync').hidden=true;
  try{
    const next=await checkSync(id);
    if(current())$('reviewSync').hidden=!(next?.pending||next?.conflict);
    await display();
  }catch{}
}
let recordRequest=0;
async function loadRecord(message='') {
  const request=++recordRequest,id=accountId;
  comparison=null;comparisonOwner=null;
  $('syncReview').hidden=$('syncRecord').hidden=$('cloudRecordText').hidden=true;
  $('localSyncStatus').textContent=message;
  const [local,guest,backup]=await Promise.all([readRecord(id),id?readRecord(null):null,sync.backup(id)]);
  if(request!==recordRequest||view!=='offlineRecord')return;
  const count=local.runs+(guest?.runs??0),escapes=local.escapes+(guest?.escapes??0);
  const awards=[['front','Front door escape'],['drain','Storm drain escape'],['nightmare','Nightmare survivor']]
    .filter(([key])=>local[key]||guest?.[key]).map(([,label])=>label);
  $('localRecordText').textContent=count+' completed runs · '+escapes+' escapes'+(awards.length?' · '+awards.join(' · '):'');
  $('resumeBackup').hidden=!backup;
  $('resumeBackup').onclick=()=>{if(backup)resumeFrom({checkpoint:backup},id);};
  if(!id||!navigator.onLine)return;
  $('syncRecord').hidden=!(local.pending.length||guest?.pending.length);
  try {
    const next=await checkSync(id);
    if(request!==recordRequest||accountId!==id||view!=='offlineRecord')return;
    comparison=next;comparisonOwner=id;
    if(next?.pending||next?.conflict) {
      $('syncReview').hidden=false;
      $('localCopy').textContent=next.local?.checkpoint?(next.source?'This device · ':'Guest save · ')+saveLabel(next.local.checkpoint):'No active checkpoint on this device.';
      $('cloudCopy').textContent=next.cloud.checkpoint?'Account · '+saveLabel(next.cloud.checkpoint):'No account save yet.';
      $('uploadSave').hidden=!next.pending;
      $('uploadSave').textContent=next.conflict?'Replace Account Save':'Upload This Save';
      $('restoreCloud').hidden=!next.conflict||next.source!==id;
    }
    const verified=await api('offline-record');
    if(request!==recordRequest||accountId!==id||view!=='offlineRecord')return;
    $('cloudRecordText').hidden=false;
    $('cloudRecordText').textContent=verified.escapes+' verified personal offline escapes on your account.';
  }catch{if(request===recordRequest&&!message)$('localSyncStatus').textContent='Could not reach your account. Your local progress is still available.';}
}
async function chooseSync(choice) {
  const id=comparisonOwner,selected=comparison;
  if(!id||!selected||saveInFlight)return;
  saveInFlight=true;$('uploadSave').disabled=$('restoreCloud').disabled=true;
  try {
    await sync.sync(id,selected,choice);
    if(view==='offlineRecord')loadRecord(choice==='cloud'?'Cloud save restored. The previous local save is available as a backup.':'Checkpoint uploaded to your account.');
  }catch(error) {
    if(view==='offlineRecord')loadRecord(error.status===409?'The account save changed. Review both copies again.':error.message);
  }finally{saveInFlight=false;$('uploadSave').disabled=$('restoreCloud').disabled=false;}
}
$('uploadSave').onclick=()=>chooseSync('local');
$('restoreCloud').onclick=()=>chooseSync('cloud');
$('syncRecord').onclick=async()=>{
  const button=$('syncRecord'),id=accountId;
  if(!id||button.disabled||!navigator.onLine)return;
  button.disabled=true;$('localSyncStatus').textContent='Verifying personal escape replays…';
  try {
    await syncRecords(id,[id,null]);
    if(view==='offlineRecord')loadRecord('Personal record checked against the game replay.');
  }catch(error){if(view==='offlineRecord')$('localSyncStatus').textContent=error.message;}
  finally{button.disabled=false;}
};
async function resumeFrom(value,owner=accountId) {
  switchTo('dispatch');
  await startSolo(value,owner);
}
async function startSolo(value=null,owner=accountId) {
  const button=value?$('continueSolo'):$('guestPlay');
  if(button.disabled)return;
  button.disabled=true;
  try {
    if(!value) {
      const previous=await sync.read(owner);
      if(previous?.checkpoint&&!confirm('Start a new run? Your current checkpoint will be kept as a backup.'))return;
      if(previous?.checkpoint&&!await writeLocal('backup:'+(owner??'guest'),previous)) {
        $('playMessage').textContent='Could not back up your current save. Free up browser storage to start a new run.';return;
      }
      setRunDifficulty();
    }
    runOwner=owner;
    $('playMessage').textContent='Preparing the house…';
    const ready=await createGameOnce();
    if(ready&&view==='dispatch'){
      $('playMessage').textContent='';ready.begin(null,value?.checkpoint,value?.replay?structuredClone(value.replay):null);
    }
  }finally{button.disabled=false;}
}
$('play').onclick=()=>navigate('dispatch');
$('multiplayerPlay').onclick=()=>{
  if(multiplayer)navigate('multiplayer');
  else location.assign('https://blackmere-house.thealanlu.chatgpt.site/?multiplayer=1');
};
$('guestPlay').onclick=()=>startSolo();
$('continueSolo').onclick=()=>{if(continueSave?.checkpoint)startSolo(continueSave);};
$('resumeDevice').onclick=()=>{if(guestSave?.checkpoint)startSolo(guestSave,null);};
$('saveSolo').onclick=async()=>{
  if(saveInFlight)return;
  const checkpoint=game?.checkpoint();
  if(!checkpoint)return;
  saveInFlight=true;$('saveSolo').disabled=true;$('saveStatus').textContent='Saving your place…';
  try {
    if(!await sync.local(runOwner,checkpoint,game.replay))throw new Error('This device could not store the save.');
    if(game.mode==='pause'){game.menu(true);navigate('dispatch');$('playMessage').textContent='Saved on this device.';}
  }catch(error){$('saveStatus').textContent=error.message;}
  finally{saveInFlight=false;$('saveSolo').disabled=false;}
};
if(social)$('rankedPlay').onclick=async()=>{
  if(!social.profile)return navigate(social.user?'profile':'auth',true);
  setRunDifficulty();
  const button=$('rankedPlay');button.disabled=true;
  $('playMessage').textContent='Starting verified run…';
  const pendingGame=createGameOnce();
  try {
    const attempt=await rankedAttempt(settings.difficulty,text=>ui.toast(text));
    if(view!=='dispatch'){attempt.cancel();return;}
    const game=await pendingGame;
    if(game)game.begin(attempt);else attempt.cancel();
  }catch(error){$('playMessage').textContent=error.message;}
  finally{button.disabled=!navigator.onLine;}
};
for(const button of document.querySelectorAll('[data-open]'))button.addEventListener('click',()=>navigate(button.dataset.open,true));
for(const button of document.querySelectorAll('[data-back]'))button.addEventListener('click',back);
for(const dialog of menuDialogs.values()) {
  dialog.addEventListener('cancel',event=>{event.preventDefault();back();});
  let pressedBackdrop=false;
  dialog.addEventListener('pointerdown',event=>{pressedBackdrop=event.target===dialog;});
  dialog.addEventListener('click',event=>{
    if(pressedBackdrop&&event.target===dialog)back();
    pressedBackdrop=false;
  });
}
for(const button of document.querySelectorAll('[data-resume]'))button.addEventListener('click',()=>game?.resume());
for(const button of document.querySelectorAll('[data-menu]'))button.addEventListener('click',()=>game?.menu());
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!event.repeat&&['dispatch','journal','note','multiplayer'].includes(view)) {
    event.preventDefault();back();
  }
});
document.addEventListener('visibilitychange',()=>{
  if(document.hidden) {
    const checkpoint=game?.checkpoint();
    if(checkpoint)sync.local(runOwner,checkpoint,game.replay);
  }
});
social?.initialize();
addEventListener('online',async()=>{
  await social?.initialize();
  if(view==='dispatch')loadContinue();
  if(view==='offlineRecord')loadRecord();
  if(accountId&&view==='menu') {
    try{const next=await checkSync(accountId);$('syncMenu').hidden=!(next?.pending||next?.conflict);}catch{}
  }
});
addEventListener('offline',()=>{$('syncMenu').hidden=true;if(view==='offlineRecord')loadRecord();});
configurePwa(navigate);
if(multiplayer&&(multiplayer.hasInvite||new URLSearchParams(location.search).has('multiplayer')))navigate('multiplayer');
