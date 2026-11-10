export function configurePwa(navigate) {
  const button=document.getElementById('installGame'),offline=document.getElementById('offlineMenu');
  let install;
  const standalone=()=>matchMedia('(display-mode: standalone)').matches||navigator.standalone===true;
  const connection=()=>{
    offline.hidden=navigator.onLine;
    document.documentElement.toggleAttribute('data-offline',!navigator.onLine);
  };
  const visibility=()=>{button.hidden=standalone();};
  addEventListener('beforeinstallprompt',event=>{event.preventDefault();install=event;visibility();});
  addEventListener('appinstalled',()=>{install=null;visibility();});
  addEventListener('online',connection);addEventListener('offline',connection);
  button.onclick=async()=>{
    if(!install){navigate('installHelp');return;}
    const prompt=install;install=null;
    try{await prompt.prompt();await prompt.userChoice;}catch{navigate('installHelp');}
    visibility();
  };
  connection();visibility();
  if('serviceWorker' in navigator&&isSecureContext) {
    navigator.serviceWorker.register(new URL('sw.js',document.baseURI),{updateViaCache:'none'}).catch(()=>{});
  }
}
