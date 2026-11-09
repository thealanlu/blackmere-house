import {body,fail,json,limit,one,write} from './http.js';

const usernamePattern=/^[A-Za-z0-9_]{3,24}$/;
export function username(value) {
  if(typeof value!=='string'||!usernamePattern.test(value.trim()))fail(400,'Use 3–24 letters, numbers, or underscores for your gamer tag.');
  return value.trim();
}
function passwordValue(value,min=10) {
  if(typeof value!=='string'||value.length<min||new TextEncoder().encode(value).byteLength>72)fail(400,'Use 10 or more characters and at most 72 UTF-8 bytes for your password.');
  return value;
}
export function supabaseEnabled(env){return /^https:\/\/[a-z0-9.-]+(?::\d+)?$/i.test(env.SUPABASE_URL??'')&&Boolean(env.SUPABASE_PUBLISHABLE_KEY);}
async function provider(env,path,{method='GET',data,token}={}) {
  const headers={apikey:env.SUPABASE_PUBLISHABLE_KEY,Accept:'application/json'};
  if(data)headers['Content-Type']='application/json';
  if(token)headers.Authorization='Bearer '+token;
  const response=await fetch(env.SUPABASE_URL+path,{method,headers,body:data?JSON.stringify(data):undefined,redirect:'manual'});
  if(response.status>=300&&response.status<400)fail(503,'Authentication is temporarily unavailable.');
  const payload=await response.json().catch(()=>null);
  return {ok:response.ok,status:response.status,payload};
}
const cookie=(request,name)=>request.headers.get('cookie')?.split(/;\s*/).find(s=>s.startsWith(name+'='))?.slice(name.length+1);
const tokenString=value=>typeof value==='string'&&/^[A-Za-z0-9._~-]{12,8192}$/.test(value);
const validSession=session=>tokenString(session?.access_token)&&tokenString(session?.refresh_token);

function put(request,response,name,value,age) {
  const secure=new URL(request.url).protocol==='https:'?'; Secure':'';
  response.headers.append('Set-Cookie',name+'='+value+'; Max-Age='+age+'; Path=/; HttpOnly; SameSite=Lax'+secure);
}
function sessionResponse(request,data,session=null) {
  const response=json(data);
  put(request,response,'bm_access',session?.access_token??'',session?Math.min(Number(session.expires_in)||3600,3600):0);
  put(request,response,'bm_refresh',session?.refresh_token??'',session?2592000:0);
  put(request,response,'bm_recovery','',0);
  return response;
}
function providerError(r,fallback) {
  const code=r.payload?.error_code??r.payload?.code;
  if(r.status===429)fail(429,'Too many authentication requests. Try again later.');
  if(code==='weak_password')fail(400,'Choose a stronger password.');
  fail(r.status>=500?503:400,fallback);
}
function accountFor(db,user) {
  if(!user?.id||!user.email)return null;
  return one(db,'SELECT username FROM profiles WHERE subject=? AND password_login=? AND closing=0','sb:'+user.id,user.email);
}
export async function identity(request,env) {
  const access=cookie(request,'bm_access');
  if(access||cookie(request,'bm_refresh')) {
    if(!tokenString(access)||!supabaseEnabled(env)||cookie(request,'bm_recovery')==='1')return null;
    const r=await provider(env,'/auth/v1/user',{token:access});
    const account=r.ok?await accountFor(env.DB,r.payload):null;
    return account?{subject:'sb:'+r.payload.id,provider:'supabase',access,username:account.username}:null;
  }
  // Hosted Sites supplies this trusted header. The portable dev server strips it from incoming requests.
  const id=request.headers.get('oai-authenticated-user-id');
  return id&&env.PLATFORM_AUTH==='1'?{subject:'site:'+id,provider:'chatgpt',username:''}:null;
}
export async function authRoute(request,env,path) {
  if(!['signup','login','refresh','logout'].includes(path))fail(404,'Unknown account action.');
  if(path==='logout') {
    const u=await identity(request,env).catch(()=>null);
    if(u?.provider==='supabase')await provider(env,'/auth/v1/logout?scope=local',{method:'POST',token:u.access}).catch(()=>{});
    return sessionResponse(request,{signedOut:true});
  }
  if(!supabaseEnabled(env))fail(503,'Player accounts are unavailable on this host.');
  const ip=request.headers.get('cf-connecting-ip')??'local';
  await limit(env.DB,'auth:'+path+':'+ip,path==='refresh'?40:12,5);
  const post=(p,data)=>provider(env,p,{method:'POST',data});
  if(path==='signup') {
    const d=await body(request,1600),name=username(d.username),password=passwordValue(d.password);
    if(await one(env.DB,'SELECT 1 FROM profiles WHERE username=?',name))fail(409,'That gamer tag is already taken.');

    // Supabase uses a login identifier internally. This random alias cannot receive mail.
    const alias='bh-'+crypto.randomUUID()+'@blackmere.invalid';
    const r=await post('/auth/v1/signup',{email:alias,password});
    if(!r.ok)providerError(r,'Could not create the account. Try again.');
    const session=r.payload;
    if(!validSession(session)||!session.user?.id||session.user.email!==alias)fail(503,'Gamer-tag signup is temporarily unavailable.');

    const player={subject:'sb:'+session.user.id,provider:'supabase',access:session.access_token};
    let saved;
    try {
      saved=await write(env.DB,'INSERT OR IGNORE INTO profiles(id,subject,username,created_at,password_login) VALUES(?,?,?,?,?)',
        crypto.randomUUID(),player.subject,name,Date.now(),alias);
    }catch(error) {
      // A failed response can follow a successful insert. Keep an account that already owns the tag.
      const existing=await accountFor(env.DB,session.user);
      if(existing)return sessionResponse(request,{signedIn:true},session);
      await removeIdentity(env,player).catch(()=>{});
      throw error;
    }
    if(saved.meta.changes!==1) {
      await removeIdentity(env,player).catch(()=>{});
      fail(409,'That gamer tag is already taken.');
    }
    return sessionResponse(request,{signedIn:true},session);
  }
  if(path==='login') {
    const d=await body(request,1600),name=username(d.username),password=passwordValue(d.password,1);
    const invalid='Gamer tag or password was incorrect.';
    const account=await one(env.DB,'SELECT subject,password_login FROM profiles WHERE username=? AND closing=0',name);
    if(!account?.password_login)fail(401,invalid);
    const r=await post('/auth/v1/token?grant_type=password',{email:account.password_login,password});
    if(r.status===400||r.status===401||r.status===403)fail(401,invalid);
    if(!r.ok)providerError(r,'Could not sign in. Try again.');
    const session=r.payload;
    if(!validSession(session)||session.user?.email!==account.password_login||'sb:'+session.user?.id!==account.subject)fail(401,invalid);
    return sessionResponse(request,{signedIn:true},session);
  }
  const refresh=cookie(request,'bm_refresh');
  if(!tokenString(refresh)||cookie(request,'bm_recovery')==='1')return sessionResponse(request,{expired:true});
  const r=await post('/auth/v1/token?grant_type=refresh_token',{refresh_token:refresh});
  if(r.status===429||r.status>=500)providerError(r,'Could not renew the session. Try again.');
  if(!r.ok||!validSession(r.payload)||!await accountFor(env.DB,r.payload.user))return sessionResponse(request,{expired:true});
  return sessionResponse(request,{signedIn:true},r.payload);
}

export async function removeIdentity(env,user) {
  if(user.provider!=='supabase')return;
  const r=await provider(env,'/rest/v1/rpc/blackmere_delete_my_account',{method:'POST',data:{},token:user.access});
  if(!r.ok)fail(503,'Account deletion could not be completed. Please try again after account administration is configured.');
}
export const cleared=(request,data)=>sessionResponse(request,data);
