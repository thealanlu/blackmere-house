import assets from './assets.generated.js';
import {HttpError,fail,json,limit} from './http.js';
import {identity,authRoute,supabaseEnabled} from './auth.js';
import {players,profileFor} from './players.js';
import {runs} from './runs.js';

async function api(request,env,url) {
  const method=request.method;
  if(!['GET','POST','PATCH','DELETE'].includes(method))fail(405,'Unsupported request.');
  if(method!=='GET') {
    const origin=request.headers.get('Origin');
    if(origin!==url.origin&&origin!==env.AUTH_ORIGIN)fail(403,'Cross-site requests are unavailable.');
  }
  if(!env.DB)fail(503,'Player services are temporarily unavailable.');
  if(url.pathname==='/api/config'&&method==='GET')return json({email:supabaseEnabled(env),chatgpt:env.PLATFORM_AUTH==='1'});
  if(url.pathname.startsWith('/api/auth/')&&method==='POST')return authRoute(request,env,url.pathname.slice(10));
  const user=await identity(request,env);
  const profile=user&&!user.recovery?await profileFor(env.DB,user):null;
  if(url.pathname==='/api/runs'||url.pathname.startsWith('/api/runs/'))return runs(request,env,url,profile);
  if(url.pathname==='/api/leaderboard')await limit(env.DB,'board:'+(user?.subject??request.headers.get('cf-connecting-ip')??'local'),80);
  return players(request,env,url,user,profile);
}
function asset(request,url) {
  if(request.method!=='GET'&&request.method!=='HEAD')return new Response('Method not allowed',{status:405});
  const item=assets[url.pathname==='/'?'/index.html':url.pathname];
  if(!item)return new Response('Not found',{status:404});
  const [type,content,binary]=item;
  const headers={'Content-Type':type,'X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer',
    'Cache-Control':type.startsWith('text/html')?'no-store':'public, max-age=0, must-revalidate'};
  if(type.startsWith('text/html'))headers['Content-Security-Policy']="default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'";
  return new Response(request.method==='HEAD'?null:binary?Uint8Array.from(atob(content),c=>c.charCodeAt(0)):content,{headers});
}
export default {
  async fetch(request,env) {
    try {
      const url=new URL(request.url);
      if(url.pathname.startsWith('/api/'))return await api(request,env,url);
      return asset(request,url);
    }catch(error) {
      if(error instanceof HttpError)return json({error:error.message},error.status);
      console.error('Blackmere request failed',error.name,error.message?.slice(0,180));
      return json({error:'The request could not be completed. Try again.'},500);
    }
  }
};
