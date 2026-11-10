import {supportedPad} from './input.js';

const $=id=>document.getElementById(id);

export function bindDevices(settings,{view,back,controlHint}) {
  const root=document.documentElement,coarse=matchMedia('(pointer: coarse)');
  let last=coarse.matches?'touch':'mouse',dismissed=false,padPrevious=[],padDirection=0,repeatAt=0;
  function kind() {
    if(settings.controlsMode==='touch')return 'touch';
    if(settings.controlsMode==='traditional'&&last==='touch')return 'mouse';
    return last;
  }
  function rotation() {
    $('rotateHint').hidden=dismissed||view()!=='play'||kind()!=='touch'||innerWidth>=innerHeight||innerWidth>590;
  }
  function apply() {
    root.dataset.controls=kind();root.dataset.stickSide=settings.joystickSide;
    root.style.setProperty('--stick-factor',settings.joystickSize);
    root.style.setProperty('--stick-alpha',settings.joystickOpacity);
    root.style.setProperty('--stick-inset',settings.joystickInset+'px');
    root.style.setProperty('--stick-height',settings.joystickHeight+'px');
    controlHint(kind());rotation();
  }
  function mark(next) {
    if(last===next)return;
    last=next;apply();
  }
  coarse.addEventListener?.('change',e=>mark(e.matches?'touch':'mouse'));
  document.addEventListener('pointerdown',e=>mark(e.pointerType==='touch'||e.pointerType==='pen'?'touch':'mouse'),{capture:true});
  document.addEventListener('keydown',e=>{if(e.isTrusted)mark('mouse');},{capture:true});
  $('dismissRotate').onclick=()=>{dismissed=true;rotation();};
  window.addEventListener('resize',rotation);
  const viewport=window.visualViewport;
  const resizeViewport=()=>{
    if(viewport&&viewport.height<innerHeight-80)root.style.setProperty('--visual-height',Math.round(viewport.height)+'px');
    else root.style.removeProperty('--visual-height');
    rotation();
  };
  viewport?.addEventListener('resize',resizeViewport);
  function fullscreenActive(){return document.fullscreenElement??document.webkitFullscreenElement;}
  function labelFullscreen(){
    for(const b of document.querySelectorAll('[data-fullscreen]'))b.textContent=fullscreenActive()?'Exit Fullscreen':'Enter Fullscreen';
  }
  for(const b of document.querySelectorAll('[data-fullscreen]'))b.onclick=async()=>{
    try {
      if(fullscreenActive())await (document.exitFullscreen??document.webkitExitFullscreen).call(document);
      else {
        const request=root.requestFullscreen??root.webkitRequestFullscreen;
        if(!request)throw new Error('Fullscreen unavailable');
        await request.call(root);
      }
      $('fullscreenStatus').textContent='';
    }catch{
      $('fullscreenStatus').textContent='Fullscreen is unavailable in this browser. You can try launching the installed Home Screen app.';
      if(view()==='pause')$('saveStatus').textContent=$('fullscreenStatus').textContent;
    }
    labelFullscreen();
  };
  document.addEventListener('fullscreenchange',labelFullscreen);
  document.addEventListener('webkitfullscreenchange',labelFullscreen);
  function menuNavigation() {
    if(document.hidden)return;
    const pad=supportedPad();
    if(!pad){padPrevious=[];padDirection=0;return;}
    const next=pad.buttons.map(button=>button.pressed);
    const edge=i=>next[i]&&!padPrevious[i];
    if(!['play','caught'].includes(view())) {
      const x=pad.axes[0]??0,y=pad.axes[1]??0;
      const direction=next[12]||next[14]||y<-.6||x<-.6?-1:next[13]||next[15]||y>.6||x>.6?1:0;
      const now=performance.now();
      if(direction&&(direction!==padDirection||now>=repeatAt)) {
        mark('pad');
        const panel=$('fatal').hidden?(document.querySelector('dialog[open]')??document.querySelector('.screen:not([hidden])')):$('fatal');
        const fields=[...(panel?.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary')??[])]
          .filter(el=>el.getClientRects().length&&el.tabIndex>=0);
        if(fields.length){
          const i=fields.indexOf(document.activeElement);
          fields[i<0?(direction>0?0:fields.length-1):(i+direction+fields.length)%fields.length].focus({preventScroll:false});
        }
        repeatAt=now+(direction===padDirection?155:370);
      }
      padDirection=direction;
      if(edge(0)){mark('pad');document.activeElement?.click();}
      if(edge(1)||edge(8)||edge(9)){mark('pad');back();}
    }else padDirection=0;
    padPrevious=next;
  }
  setInterval(menuNavigation,85);
  return {apply,mark,kind,rotation};
}
