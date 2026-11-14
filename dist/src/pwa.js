export function configurePwa(navigate) {
  const $=id=>document.getElementById(id);
  const installButton=$('installGame'),downloadButton=$('downloadOffline'),repair=$('repairOffline');
  const offline=$('offlineMenu'),note=$('offlineStatus'),storage=$('offlineStorage'),bar=$('offlineProgress');
  const supported='serviceWorker' in navigator&&isSecureContext;
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const bytes=value=>value>=1024*1024?(value/1024/1024).toFixed(1)+' MB':Math.ceil(value/1024)+' KB';
  let install,registration,registering,busy=false,checking=false,ready=false;

  function connection() {
    const disconnected=!navigator.onLine;
    offline.hidden=!disconnected;
    offline.textContent=ready?'Offline · Single Player is ready.':'Offline · Reconnect if the game files need repair.';
    document.documentElement.toggleAttribute('data-offline',disconnected);
    document.querySelectorAll('[data-needs-online]').forEach(control=>{control.disabled=disconnected;});
    repair.disabled=disconnected||busy||!supported;
  }
  async function reportStorage(remaining,total) {
    const estimate=await navigator.storage?.estimate?.().catch(()=>null);
    const free=estimate?.quota===undefined?null:Math.max(0,estimate.quota-estimate.usage);
    if(bar.max!==total||bar.value!==total-remaining)return;
    storage.textContent=bytes(total)+' total · '+bytes(remaining)+' remaining'+(free===null?'':' · '+bytes(free)+' available');
  }
  function progress({remaining,total}) {
    bar.max=total;bar.value=total-remaining;
    reportStorage(remaining,total);
  }
  function present(status) {
    progress(status);
    ready=status.remaining===0;
    note.textContent=ready?'Ready for offline play. All game files verified.':'Some game files are missing or damaged. Download or repair them while online.';
    downloadButton.textContent=ready?'Offline Content ✓':'Download Offline Content';
    repair.textContent=ready?'Check for Updates':'Download / Repair';
    connection();
  }
  function ask(worker,type,onProgress) {
    return new Promise((resolve,reject)=>{
      const channel=new MessageChannel(),timeout=setTimeout(()=>fail(new Error('The offline check timed out. Try again.')),30_000);
      function fail(error){clearTimeout(timeout);channel.port1.close();reject(error);}
      channel.port1.onmessage=({data})=>{
        if(data.progress){onProgress?.(data.progress);return;}
        if(data.error){fail(new Error(data.error));return;}
        clearTimeout(timeout);channel.port1.close();resolve(data.status);
      };
      worker.postMessage({type},[channel.port2]);
    });
  }
  function observe(worker) {
    worker?.addEventListener('statechange',()=>{
      if(worker.state==='activated'||worker.state==='redundant'||worker.state==='installed')inspect();
    });
  }
  async function inspect() {
    if(checking||busy||!supported)return;
    checking=true;
    try {
      if(registration?.active?.state==='activated')present(await ask(registration.active,'offline-status'));
      if(registration?.waiting)note.textContent=ready?'An update is ready. Close all Blackmere tabs and reopen to switch versions.':note.textContent;
    }catch{ready=false;note.textContent='Offline files could not be checked. Reconnect and use Download / Repair.';connection();}
    finally{checking=false;}
  }
  function open() {navigate('installHelp');inspect();}
  downloadButton.onclick=open;
  const visibility=()=>{installButton.hidden=standalone();};
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();install=event;visibility();});
  addEventListener('appinstalled',()=>{install=null;visibility();});
  addEventListener('online',()=>{connection();inspect();});
  addEventListener('offline',connection);
  installButton.onclick=async()=>{
    if(!install){open();return;}
    const prompt=install;install=null;
    try{await prompt.prompt();await prompt.userChoice;}catch{}
    visibility();open();
  };
  repair.onclick=async()=>{
    if(!navigator.onLine||busy)return;
    busy=true;connection();note.textContent='Checking for the latest files…';
    try {
      // Request durable storage while the player is directly interacting with the download control.
      navigator.storage?.persist?.().catch(()=>{});
      await register();
      if(!registration.installing)await registration.update().catch(()=>{});
      const worker=registration.installing??registration.waiting??registration.active;
      if(!worker)throw new Error('Offline download could not start. Try again while online.');
      const start=await ask(worker,'offline-status');
      const estimate=await navigator.storage?.estimate?.().catch(()=>null);
      if(estimate?.quota&&start.remaining>estimate.quota-estimate.usage)throw new Error('Free up browser storage before downloading.');
      note.textContent='Downloading and verifying game files…';
      present(await ask(worker,'offline-download',progress));
      if(registration.waiting)note.textContent+=' Close all Blackmere tabs and reopen to switch to the downloaded update.';
    }catch(error){note.textContent=error.message||'Download failed. Try again while online.';}
    finally{busy=false;connection();}
  };
  async function register() {
    registering??=navigator.serviceWorker.getRegistration(document.baseURI).then(existing=>
      existing??navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{updateViaCache:'none'})
    ).then(found=>{
      registration=found;
      found.addEventListener('updatefound',()=>observe(found.installing));
      observe(found.installing);
      if(navigator.onLine)found.update().catch(()=>{});
    }).catch(error=>{registering=null;throw error;});
    return registering;
  }
  connection();visibility();
  if(!supported) {
    note.textContent='Offline installation requires a browser with service worker support and a secure connection.';
    return;
  }
  navigator.serviceWorker.addEventListener('controllerchange',inspect);
  document.addEventListener('visibilitychange',()=>{if(!document.hidden)inspect();});
  // The manifest also tells the UI how much space remains when no worker is installed yet.
  if(navigator.onLine)fetch(new URL('offline-manifest.json',document.baseURI),{credentials:'omit'})
    .then(response=>response.json()).then(value=>{
      if(!registration?.active&&!ready&&!busy)progress({remaining:value.total,total:value.total});
    }).catch(()=>{});
  register().then(()=>{
    inspect();
    if(!registration.active) {
      note.textContent='Preparing the offline download…';
      const installing=registration.installing;
      if(installing)ask(installing,'offline-download',progress).catch(()=>{});
      const waitForReady=setTimeout(()=>{
        if(!ready&&!registration.active)note.textContent='Select Download / Repair to retry the offline download.';
      },12_000);
      navigator.serviceWorker.ready.then(()=>{clearTimeout(waitForReady);inspect();});
    }
  }).catch(()=>{note.textContent='Offline installation could not start. Try Download / Repair while online.';});
}
