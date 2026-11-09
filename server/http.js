export class HttpError extends Error {
  constructor(status,message){super(message);this.status=status;}
}
export const fail=(status,message)=>{throw new HttpError(status,message);};
export const json=(data,status=200,headers={})=>new Response(JSON.stringify(data),{status,headers:{
  'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff',...headers
}});
export async function body(request,limit=44000) {
  if(!/^application\/json(?:;|$)/i.test(request.headers.get('content-type')??''))fail(415,'Send JSON.');
  if(Number(request.headers.get('content-length'))>limit)fail(413,'Request is too large.');
  if(!request.body)fail(400,'Request body is missing.');
  const reader=request.body.getReader(), decoder=new TextDecoder();
  let size=0,text='';
  for(;;) {
    const {value,done}=await reader.read();
    if(done)break;
    if((size+=value.byteLength)>limit){await reader.cancel();fail(413,'Request is too large.');}
    text+=decoder.decode(value,{stream:true});
  }
  let data;
  try{data=JSON.parse(text+decoder.decode());}catch{fail(400,'Malformed JSON.');}
  if(!data||typeof data!=='object'||Array.isArray(data))fail(400,'Expected a JSON object.');
  return data;
}
export async function limit(db,key,max,minutes=1) {
  const minute=Math.floor(Date.now()/60000);
  const window=minute-minute%minutes;
  const row=await db.prepare(`INSERT INTO throttles(bucket,window,count) VALUES (?,?,1)
    ON CONFLICT(bucket,window) DO UPDATE SET count=count+1 RETURNING count`).bind(key,window).first();
  if(row.count>max)fail(429,'Too many requests. Try again in a moment.');
  if(row.count===1&&minute%17===0)await db.prepare('DELETE FROM throttles WHERE window<?').bind(minute-120).run();
}
export const one=(db,sql,...args)=>db.prepare(sql).bind(...args).first();
export const many=async(db,sql,...args)=>(await db.prepare(sql).bind(...args).all()).results;
export const write=(db,sql,...args)=>db.prepare(sql).bind(...args).run();
export const statement=(db,sql,...args)=>db.prepare(sql).bind(...args);
