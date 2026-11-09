import { createGame } from './game.js';
import { itemInfo, levels } from './rules.js';
import { rankedAttempt } from './online.js';
import { bindSocial, timeLabel } from './social.js';

const $=id=>document.getElementById(id);
const defaults={difficulty:'normal',graphics:'medium',volume:.72,sensitivity:1,motion:!matchMedia('(prefers-reduced-motion: reduce)').matches};
let saved={};
try {saved=JSON.parse(localStorage.getItem('blackmere.settings')||'{}')||{};} catch {}
const settings={
  difficulty:Object.hasOwn(levels,saved.difficulty)?saved.difficulty:defaults.difficulty,
  graphics:['low','medium','high'].includes(saved.graphics)?saved.graphics:defaults.graphics,
  volume:Number.isFinite(saved.volume)?Math.max(0,Math.min(1,saved.volume)):defaults.volume,
  sensitivity:Number.isFinite(saved.sensitivity)?Math.max(.25,Math.min(2.5,saved.sensitivity)):defaults.sensitivity,
  motion:typeof saved.motion==='boolean'?saved.motion:defaults.motion
};
const screens=[...document.querySelectorAll('.screen')];
let view='menu', returnView='menu',game,toastTimer,revealTimer,threatLabel='',lastPrompt='';
const guestOnly=document.documentElement.dataset.edition==='guest';
const social=guestOnly?null:bindSocial(navigate,name=>view===name);
function fatal(error) {
  console.error(error);
  const box=$('fatal');
  box.textContent='3D rendering could not start. Open the game in a desktop browser with WebGL 2 enabled, then reload.';
  box.hidden=false;
}
function createGameOnce() {
  if(game)return game;
  try {game=createGame($('game'),ui,settings);return game;}
  catch(error){fatal(error);return null;}
}
function updateOptions() {
  for(const key of ['difficulty','graphics','sensitivity','volume'])$(key).value=settings[key];
  $('motion').checked=settings.motion;
  $('playDifficulty').value=settings.difficulty;
  $('levelDescription').textContent=levels[settings.difficulty].caption;
}
updateOptions();
for(const key of Object.keys(settings)) {
  $(key).addEventListener('input',e=>{
    const input=e.target;
    settings[key]=input.type==='checkbox'?input.checked:input.type==='range'?Number(input.value):input.value;
    try{localStorage.setItem('blackmere.settings',JSON.stringify(settings));}catch{}
    updateOptions();game?.configure();
  });
}
function switchTo(name) {
  view=name;
  const display=name==='play'?'playHud':['victory','interlude','defeat'].includes(name)?'result':name;
  for(const screen of screens)screen.hidden=screen.id!==display;
  if(name!=='caught')$('gameShade').classList.remove('caught');
  if(name==='play')$('game').focus({preventScroll:true});
  else if(name!=='menu'&&name!=='caught')document.getElementById(display)?.querySelector('button')?.focus({preventScroll:true});
}
$('game').tabIndex=-1;
$('game').addEventListener('webglcontextlost',event=>{
  event.preventDefault();game?.pause();fatal(new Error('WebGL context lost'));
});
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
  updateObjectives(progress) {
    const container=$('objectives');
    container.replaceChildren();
    for(const [route,goals] of rows) {
      const h=document.createElement('h3'),list=document.createElement('ul');
      h.textContent=route;
      for(const [id,label,hint] of goals) {
        const row=document.createElement('li'),caption=document.createElement('span');
        row.classList.toggle('done',progress[id]);row.textContent=(progress[id]?'✓  ':'○  ')+label;
        if(!progress[id]){caption.textContent=hint;row.append(caption);}
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
  prompt(text) {
    if(text===lastPrompt)return;
    lastPrompt=text;$('prompt').hidden=!text;$('prompt').lastElementChild.textContent=text;
    $('reticle').classList.toggle('focus',Boolean(text));
  },
  toast(text){const el=$('toast');clearTimeout(toastTimer);el.textContent=text;el.classList.add('show');toastTimer=setTimeout(()=>el.classList.remove('show'),2750);},
  area(name){$('area').textContent=name;},
  flash(on){$('flashLabel').textContent=on?'LIGHT ON':'LIGHT OFF';},
  mouseHint(show){$('mouseHint').hidden=!show;},
  hide(active){$('gameShade').classList.toggle('hide',active);},
  rankResult(data,error) {
    if(data)social?.afterResult();
    if(!['victory','defeat'].includes(view))return;
    $('rankResult').textContent=data?'Verified · '+data.score.toLocaleString()+' points · '+timeLabel(data.ticks):'Run was not recorded. '+error;
  }
};
const subviews=['settings','controls','dispatch','auth','leaderboards','friends','profile'];
function navigate(name,own=false) {
  returnView=view==='pause'?'pause':'menu';
  switchTo(name);
  social?.open(name,own);
  if(name==='dispatch') {
    $('playDifficulty').value=settings.difficulty;
    $('playMessage').textContent='';
    if(!social)return;
    const update=()=>{
      $('rankedPlay').firstElementChild.textContent=social.profile?'Ranked run':social.user?'Create a profile to play ranked':'Log in to play ranked';
      $('rankedHelp').textContent=social.profile?'Verified runs count toward your record.':'A player profile is required to record a verified result.';
    };
    update();social.session().then(update);
  }
}
function back() {
  if(subviews.includes(view))switchTo(returnView);
  else if(['journal','note','pause'].includes(view))game?.resume();
}
function setRunDifficulty() {
  settings.difficulty=$('playDifficulty').value;
  $('difficulty').value=settings.difficulty;
  try{localStorage.setItem('blackmere.settings',JSON.stringify(settings));}catch{}
}
$('play').onclick=()=>navigate('dispatch');
$('guestPlay').onclick=()=>{setRunDifficulty();createGameOnce()?.begin();};
if(social)$('rankedPlay').onclick=async()=>{
  if(!social.profile)return navigate(social.user?'profile':'auth',true);
  setRunDifficulty();
  const button=$('rankedPlay');button.disabled=true;
  $('playMessage').textContent='Starting verified run…';
  try {
    const attempt=await rankedAttempt(settings.difficulty,text=>ui.toast(text));
    if(view!=='dispatch'){attempt.cancel();return;}
    const game=createGameOnce();
    if(game)game.begin(attempt);else attempt.cancel();
  }catch(error){$('playMessage').textContent=error.message;}
  finally{button.disabled=false;}
};
for(const button of document.querySelectorAll('[data-open]'))button.addEventListener('click',()=>navigate(button.dataset.open,true));
for(const button of document.querySelectorAll('[data-back]'))button.addEventListener('click',back);
for(const button of document.querySelectorAll('[data-resume]'))button.addEventListener('click',()=>game?.resume());
for(const button of document.querySelectorAll('[data-menu]'))button.addEventListener('click',()=>game?.menu());
document.addEventListener('keydown',event=>{
  if(event.key==='Escape'&&!event.repeat&&[...subviews,'journal','note'].includes(view)) {
    event.preventDefault();back();
  }
});
social?.initialize();
