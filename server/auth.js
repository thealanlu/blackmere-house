import {body,fail,json,limit} from './http.js';

const usernamePattern=/^[A-Za-z0-9_]{3,24}$/;
export function username(value) {
  if(typeof value!=='string'||!usernamePattern.test(value.trim()))fail(400,'Use 3–24 letters, numbers, or underscores for your username.');
  return value.trim();
}
function emailAddress(value) {
  if(typeof value!=='string'||value.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim()))fail(400,'Enter a valid email address.');
  return value.trim().toLowerCase();
}
function passwordValue(value,min=10) {
  if(typeof value!=='string'||value.length<min||new TextEncoder().encode(value).byteLength>72)fail(400,'Use 10 or more characters and at most 72 UTF-8 bytes for your password.');
  return value;
}
export function supabaseEnabled(env){return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(env.SUPABASE_URL??'')&&Boolean(env.SUPABASE_PUBLISHABLE_KEY);}
export async function provider(env,path,{method='GET',data,token}={}) {
  const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,Accept:'application/json'};
  if(data)headers['Content-Type']='application/json';
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(env.SUPABASE_URL+path,{method,headers,body:data?JSON.stringify(data):undefined,redirect:'error'});
  const payload=await response.json().catch(()=>null);
  return {ok:response.ok,status:response.status,payload};
}
const cookie=(request,name)=>request.headers.get('cookie')?.split(/;\s*/).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
const tokenString=value=>typeof value==='string'&&/^[A-Za-z0-9._~-]{12,8192}$/.test(value);
function put(request,response,name,value,age) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  response.headers.append('Set-Cookie',name+'='+value+'; Max-Age='+age+'; Path=/; HttpOnly; SameSite=Lax'+secure);
}
function sessionResponse(request,data,session=null,clear=false,recovery=false) {
  const response=json(data);
  if(session||clear) {
    put(request,response,'bm_access',clear?'':session.access_token,clear?0:Math.min(Number(session.expires_in)||3600,3600));
    put(request,response,'bm_refresh',clear?'':session.refresh_token,clear?0:2592000);
    put(request,response,'bm_recovery',recovery?'1':'',recovery?900:0);
  }
  return response;
}
const base64url=bytes=>btoa(String.fromCharCode(...bytes)).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');
async function pkce() {
  const verifier=base64url(crypto.getRandomValues(new Uint8Array(32)));
  const challenge=base64url(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(verifier))));
  return {verifier,fields:{code_challenge:challenge,code_challenge_method:'s256'}};
}
function pendingLink(request,result,verifier,kind) {
  const response=json(result);
  put(request,response,'bm_pkce',verifier,3600);
  put(request,response,'bm_link',kind,3600);
  return response;
}
function providerError(r,fallback) {
  const code=r.payload?.error_code??r.payload?.code;
  if(r.status===429)fail(429,'Email or authentication rate limit reached. Try again later.');
  if(code==='email_address_not_authorized')fail(503,'This project’s email provider only delivers to approved recipients.');
  if(code==='email_not_confirmed')fail(403,'Verify your email before signing in.');
  if(code==='weak_password')fail(400,'Choose a stronger password.');
  fail(r.status>=500?503:400,fallback);
}
export async function identity(request,env) {
  const access=cookie(request,'bm_access');
  if(access||cookie(request,'bm_refresh')) {
    if(!tokenString(access)||!supabaseEnabled(env))return null;
    const r=await provider(env,'/auth/v1/user',{token:access});
    if(!r.ok||!r.payload?.id||!r.payload.email_confirmed_at)return null;
    return {subject:'sb:'+r.payload.id,provider:'supabase',access,username:r.payload.user_metadata?.username??'',recovery:cookie(request,'bm_recovery')==='1'};
  }
  // Hosted Sites supplies this trusted header. The portable dev server strips it from incoming requests.
  const id=request.headers.get('oai-authenticated-user-id');
  return id&&env.PLATFORM_AUTH==='1'?{subject:'site:'+id,provider:'chatgpt',username:''}:null;
}
export async function authRoute(request,env,path) {
  if(!supabaseEnabled(env))fail(503,'Email accounts are unavailable on this host.');
  const ip=request.headers.get('cf-connecting-ip')??'local';
  await limit(env.DB,'auth:'+path+':'+ip,path==='refresh'?40:12,5);
  const origin=new URL(request.url).origin;
  const redirect=encodeURIComponent((env.AUTH_ORIGIN??origin).replace(/\/$/,'')+'/');
  const post=(p,data,token)=>provider(env,p,{method:'POST',data,token});
  if(path==='signup') {
    const d=await body(request,2400),name=username(d.username),email=emailAddress(d.email),password=passwordValue(d.password);
    const reserved=await env.DB.prepare('SELECT 1 FROM profiles WHERE username=?').bind(name).first();
    if(reserved)fail(409,'That username is already taken.');
    const {verifier,fields}=await pkce();
    const r=await post('/auth/v1/signup?redirect_to='+redirect,{email,password,data:{username:name},...fields});
    if(!r.ok)providerError(r,'Could not create the account. Check the details and try again.');
    if(r.payload?.access_token)return sessionResponse(request,{verified:true},r.payload);
    return pendingLink(request,{verification:true},verifier,'verify');
  }
  if(path==='login') {
    const d=await body(request,2000);
    const r=await post('/auth/v1/token?grant_type=password',{email:emailAddress(d.email),password:passwordValue(d.password,1)});
    if(!r.ok)providerError(r,'Email or password was incorrect.');
    if(!r.payload?.user?.email_confirmed_at)fail(403,'Verify your email before signing in.');
    return sessionResponse(request,{signedIn:true},r.payload);
  }
  if(path==='recover') {
    const d=await body(request,1200);
    const {verifier,fields}=await pkce();
    const r=await post('/auth/v1/recover?redirect_to='+redirect,{email:emailAddress(d.email),...fields});
    if(!r.ok&&r.status!==422)providerError(r,'Could not send a reset email. Try again later.');
    return pendingLink(request,{sent:true},verifier,'reset');
  }
  if(path==='session') {
    const d=await body(request,1800);
    if(!tokenString(d.code))fail(400,'This link is invalid or expired.');
    const kind=cookie(request,'bm_link'),verifier=cookie(request,'bm_pkce');
    const invalid='Open the email link in the browser where you requested it, or request a new link.';
    if(!tokenString(verifier)||!['reset','verify'].includes(kind))fail(400,invalid);
    const r=await post('/auth/v1/token?grant_type=pkce',{auth_code:d.code,code_verifier:verifier});
    if(!r.ok||!r.payload?.user?.email_confirmed_at)fail(400,invalid);
    const response=sessionResponse(request,{signedIn:true,recovery:kind==='reset'},r.payload,false,kind==='reset');
    put(request,response,'bm_pkce','',0);put(request,response,'bm_link','',0);
    return response;
  }
  if(path==='refresh') {
    const refresh=cookie(request,'bm_refresh');
    if(!tokenString(refresh))fail(401,'Sign in to continue.');
    const r=await post('/auth/v1/token?grant_type=refresh_token',{refresh_token:refresh});
    if(!r.ok)return sessionResponse(request,{expired:true},null,true);
    return sessionResponse(request,{signedIn:true},r.payload,false,cookie(request,'bm_recovery')==='1');
  }
  if(path==='reset') {
    const d=await body(request,1600),user=await identity(request,env);
    if(user?.provider!=='supabase'||!user.recovery)fail(401,'Open the reset link from your email first.');
    const r=await provider(env,'/auth/v1/user',{method:'PUT',data:{password:passwordValue(d.password)},token:user.access});
    if(!r.ok)providerError(r,'Could not change your password.');
    await post('/auth/v1/logout?scope=global',{},user.access);
    return sessionResponse(request,{updated:true},null,true);
  }
  if(path==='logout') {
    const u=await identity(request,env);
    if(u?.provider==='supabase')await post('/auth/v1/logout?scope=local',{},u.access).catch(()=>{});
    return sessionResponse(request,{signedOut:true},null,true);
  }
  fail(404,'Unknown account action.');
}

export async function removeIdentity(env,user) {
  if(user.provider!=='supabase')return;
  const r=await provider(env,'/rest/v1/rpc/blackmere_delete_my_account',{method:'POST',data:{},token:user.access});
  if(!r.ok)fail(503,'Account deletion could not be completed. Please try again after account administration is configured.');
}
export const cleared=(request,data)=>sessionResponse(request,data,null,true);
