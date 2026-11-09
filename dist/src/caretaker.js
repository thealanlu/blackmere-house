import * as T from '../vendor/three.module.js';
import { vertices, uv, triangles } from './face-topology.js';
import { oval, skinDetail, loadSkin } from './skin.js';

const {sin,cos,PI} = Math;
const v3=(x,y,z)=>new T.Vector3(x,y,z);
const material=(color,extra={})=>new T.MeshStandardMaterial({color,roughness:.89,...extra});
const scalp=material(0x8a7368);
const hair=Array.from({length:5},(_,i)=>material(new T.Color().setHSL(.105,.055,.16+i*.063),{roughness:.74}));
const skin=material(0x806c61);
const dark=material(0x251d20);
const lace=material(0x494239);
const buckle=material(0x6b5740,{metalness:.75,roughness:.4});
const metal=material(0x343e3e,{metalness:.82,roughness:.37});
const shoe=material(0x1b1716);
const faceMat=new T.MeshPhysicalMaterial({color:0xf5f0ec,roughness:.81,specularIntensity:.38,bumpMap:skinDetail,bumpScale:.0038,side:T.DoubleSide});
const sphere=new T.SphereGeometry(1,22,16);

function mesh(g,m,parent,x=0,y=0,z=0) {
  const obj=new T.Mesh(g,m);obj.position.set(x,y,z);
  obj.castShadow=true;obj.receiveShadow=true;parent.add(obj);return obj;
}
function ellipsoid(parent,m,x,y,z,a,b,c) {
  const o=mesh(sphere,m,parent,x,y,z);o.scale.set(a,b,c);return o;
}
function group(parent,x=0,y=0,z=0) {
  const o=new T.Group();o.position.set(x,y,z);parent.add(o);return o;
}
function line(parent,m,points,radius,sides=6) {
  return mesh(new T.TubeGeometry(new T.CatmullRomCurve3(points),Math.max(6,points.length*4),radius,sides,false),m,parent);
}
function clothMaterial(color) {
  const c=Object.assign(document.createElement('canvas'),{width:256,height:256});
  const g=c.getContext('2d');
  g.fillStyle='#a19c91';g.fillRect(0,0,256,256);
  for(let i=0;i<256;i+=3) {
    g.fillStyle=i%9?'#4d464046':'#6d635b8a';g.fillRect(i,0,1,256);
    g.fillStyle='#d5cbbb54';g.fillRect(0,i,256,1);
  }
  for(let i=0;i<55;i++) {
    const x=(i*137.31)%256,y=(i*91.57)%256,r=6+(i*9.7)%34;
    const wash=g.createRadialGradient(x,y,0,x,y,r);
    wash.addColorStop(0,i%5?'#38383038':'#c0ac8254');wash.addColorStop(1,'transparent');
    g.fillStyle=wash;g.fillRect(x-r,y-r,r*2,r*2);
  }
  const texture=new T.CanvasTexture(c);
  texture.colorSpace=T.SRGBColorSpace;texture.wrapS=texture.wrapT=T.RepeatWrapping;texture.repeat.set(3,5);
  return new T.MeshPhysicalMaterial({color,map:texture,bumpMap:texture,bumpScale:.0028,side:T.DoubleSide,
    roughness:.96,sheen:.24,sheenRoughness:.84,sheenColor:0x68655d});
}
const dress=clothMaterial(0x343c3f);
const apron=clothMaterial(0x776d61);

function cloth(parent,m,rings,arc=PI*2,offset=0,fold=.02) {
  const p=[],uvs=[],ids=[],n=44;
  const smoothRings=[];
  for(let i=0;i<rings.length-1;i++) {
    for(let j=0;j<3;j++) {
      const u=j/3,v=u*u*(3-2*u);
      smoothRings.push(rings[i].map((a,k)=>T.MathUtils.lerp(a,rings[i+1][k],k?v:u)));
    }
  }
  smoothRings.push(rings.at(-1));
  smoothRings.forEach(([y,rx,rz,z],row)=>{
    for(let i=0;i<=n;i++) {
      const u=i/n,a=offset+u*arc,r=sin(a*9+y*3)*fold+sin(a*17-y*4)*fold*.38;
      p.push(sin(a)*(rx+r),y+sin(a*13)*fold*.36,cos(a)*(rz+r)+z);
      uvs.push(u,row/(smoothRings.length-1));
      if(row && i) {const j=row*(n+1)+i;ids.push(j-n-2,j-n-1,j,j-n-2,j,j-1);}
    }
  });
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(p,3));g.setAttribute('uv',new T.Float32BufferAttribute(uvs,2));
  g.setIndex(ids);g.computeVertexNormals();return mesh(g,m,parent);
}
const headPoints=vertices.map(([x,y,z])=>{
  const cheeks=Math.exp(-((y+.1)**2/7+(Math.abs(x)-4.5)**2/1.8));
  const chin=T.MathUtils.smoothstep(-y,5.2,9.4);
  return v3(x*(.0194+chin*.0006)+(y<0?.0011*sin(y*.55):0),(y+.4)*.0225,(z-3.4)*.025-.009*cheeks);
});
const eyesLoops=[
  [33,246,161,160,159,158,157,173,133,155,154,153,145,144,163,7],
  [362,398,384,385,386,387,388,466,263,249,390,373,374,380,381,382],
];
const eyeSets=eyesLoops.map(loop=>new Set(loop));
const closingLid=new Map(eyesLoops.flatMap(loop=>loop.map((id,i)=>[id,Math.sin(i/8*PI)*.009])));
const geometry=new T.BufferGeometry();
{
  const points=headPoints.map(p=>p.clone()), coords=uv.map(p=>[...p]);
  const jaw=points.map(p=>T.MathUtils.smoothstep(-p.y,.091,.17));
  const ids=triangles.filter(face=>!eyeSets.some(set=>face.every(id=>set.has(id)))).flat();
  let previous=oval;
  for(const t of [.14,.28,.44,.60,.75,.87,.95,.985]) {
    const row=[];
    for(const i of oval) {
      const p=headPoints[i],theta=t*PI*.5;
      row.push(points.length);
      points.push(v3(p.x*cos(theta)*(1+sin(t*PI)*.09),.018+(p.y-.018)*cos(theta)*(1+sin(t*PI)*.30),p.z*cos(theta)-.193*sin(theta)));
      const u=uv[i][0],v=uv[i][1];
      coords.push([u+Math.sign(u-.5)*t*.075,v+Math.sign(v-.48)*t*.16]);
      jaw.push(jaw[i]*(1-t));
    }
    for(let j=0;j<row.length;j++) {
      const k=(j+1)%row.length;
      ids.push(previous[j],previous[k],row[j],previous[k],row[k],row[j]);
    }
    previous=row;
  }
  const back=points.length;
  points.push(v3(0,.018,-.193));coords.push([.055,.92]);jaw.push(0);
  for(let i=0;i<previous.length;i++)ids.push(previous[i],previous[(i+1)%previous.length],back);
  geometry.setAttribute('position',new T.Float32BufferAttribute(points.flatMap(p=>p.toArray()),3));
  geometry.setAttribute('uv',new T.Float32BufferAttribute(coords.flat(),2));
  geometry.setIndex(ids);geometry.computeVertexNormals();
  geometry.morphAttributes.position=[
    new T.Float32BufferAttribute(points.flatMap((p,i)=>[p.x,p.y-jaw[i]*.032,p.z-jaw[i]*.013]),3),
    new T.Float32BufferAttribute(points.flatMap((p,i)=>[p.x,p.y-(closingLid.get(i)??0),p.z]),3),
    new T.Float32BufferAttribute(points.flatMap((p,i)=>{
      if(i>=headPoints.length)return p.toArray();
      const brow=Math.exp(-((p.y-.106)**2/.00034+(Math.abs(p.x)-.063)**2/.0011));
      const cheek=Math.exp(-((p.y+.074)**2/.00042+(Math.abs(p.x)-.056)**2/.0006));
      return [p.x,p.y-brow*.011+cheek*.006,p.z+brow*.005+cheek*.003];
    }),3)
  ];
}

const eyeSurface = (() => {
  const canvas=Object.assign(document.createElement('canvas'),{width:256,height:96});
  const g=canvas.getContext('2d');
  const gradient=g.createLinearGradient(0,0,0,96);
  gradient.addColorStop(0,'#4b3933');gradient.addColorStop(.35,'#b7a79b');gradient.addColorStop(.68,'#b7a99d');gradient.addColorStop(1,'#78625b');
  g.fillStyle=gradient;g.fillRect(0,0,256,96);
  g.save();g.translate(128,48);g.scale(1,1.25);
  const irisPaint=g.createRadialGradient(0,0,11,0,0,30);
  irisPaint.addColorStop(0,'#242a20');irisPaint.addColorStop(.35,'#697765');irisPaint.addColorStop(.75,'#8b9780');irisPaint.addColorStop(1,'#33392e');
  g.fillStyle=irisPaint;g.beginPath();g.arc(0,0,30,0,2*PI);g.fill();
  for(let i=0;i<100;i++){
    const a=i/100*2*PI,r=13+5*sin(i*3.2);
    g.strokeStyle=i%2?'#29352c75':'#cacba66b';
    g.beginPath();g.moveTo(cos(a)*r,sin(a)*r);g.lineTo(cos(a+.04)*29,sin(a+.04)*29);g.stroke();
  }
  g.fillStyle='#181a18';g.beginPath();g.arc(0,0,12,0,2*PI);g.fill();
  g.fillStyle='#fff7e29e';g.beginPath();g.ellipse(-6,-7,3.5,2.8,0,0,2*PI);g.fill();g.restore();
  const texture=new T.CanvasTexture(canvas);texture.colorSpace=T.SRGBColorSpace;
  return texture;
})();
const eyeMat=material(0xffffff,{map:eyeSurface,roughness:.45});

function buildEye(root,loop) {
  const n=loop.length,p=loop.map(i=>headPoints[i].clone());
  const center=p.reduce((sum,v)=>sum.add(v),v3(0,0,0)).multiplyScalar(1/n);
  const bounds=new T.Box3().setFromPoints(p);
  const uv=[],positions=[],blinking=[],ids=[];
  for(const t of [0,.48])for(let i=0;i<n;i++) {
    const point=p[i].clone().lerp(center,t);
    point.z+=t*.012-.00014;
    positions.push(...point.toArray());
    uv.push((point.x-bounds.min.x)/(bounds.max.x-bounds.min.x), (point.y-bounds.min.y)/(bounds.max.y-bounds.min.y));
    blinking.push(point.x,point.y-(closingLid.get(loop[i])??0)*(1-t),point.z);
  }
  positions.push(center.x,center.y,center.z+.008);blinking.push(center.x,center.y,center.z+.008);uv.push(.5,.5);
  for(let i=0;i<n;i++) {
    const j=(i+1)%n;
    ids.push(i,n+i,j,j,n+i,n+j,n+i,n*2,n+j);
  }
  const g=new T.BufferGeometry();
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));
  g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(ids);g.computeVertexNormals();
  g.morphAttributes.position=[new T.Float32BufferAttribute(blinking,3)];
  return mesh(g,eyeMat,root);
}

function crown(root) {
  const c=Object.assign(document.createElement('canvas'),{width:256,height:128});
  const paint=c.getContext('2d');paint.fillStyle='#8a8071';paint.fillRect(0,0,256,128);
  for(let i=0;i<380;i++){
    const x=(i*137.3)%256;
    paint.strokeStyle=i%5?'#4c494063':'#d9d0c052';paint.lineWidth=.35+i%4*.14;
    paint.beginPath();paint.moveTo(x,128);paint.quadraticCurveTo(x-3*sin(i),57,x+4*cos(i),0);paint.stroke();
  }
  const texture=new T.CanvasTexture(c);texture.colorSpace=T.SRGBColorSpace;
  const g=new T.BufferGeometry(),positions=[],uv=[],indices=[],count=80,rows=12;
  for(let j=0;j<=rows;j++)for(let i=0;i<=count;i++){
    const a=i/count*PI*2,t=j/rows,front=Math.max(cos(a),0),q=cos(t*PI/2);
    const hairline=.056+.111*front**1.7+.009*sin(a*3)+.005*cos(a*7);
    positions.push(sin(a)*.147*q+.008*t,hairline*q+.222*sin(t*PI/2)-.043*sin(PI*t),-.105+cos(a)*(.123+.023*front)*q-.017*t);
    uv.push(i/count,t);
    const k=positions.length/3-1;
    if(i&&j)indices.push(k-count-2,k-count-1,k,k-count-2,k,k-1);
  }
  g.setAttribute('position',new T.Float32BufferAttribute(positions,3));g.setAttribute('uv',new T.Float32BufferAttribute(uv,2));
  g.setIndex(indices);g.computeVertexNormals();
  mesh(g,material(0xb5ada0,{map:texture,bumpMap:texture,bumpScale:.0014,side:T.DoubleSide}),root);
}
function groom(root) {
  const sets=hair.map(()=>({points:[],faces:[]}));
  for(let i=0;i<152;i++) {
    const angle=i/152*PI*2, s=sin(angle), c=cos(angle), front=Math.max(c,0);
    const fly=.008*sin(i*8.24),flock=.012*sin(angle*5)+fly;
    const path=new T.CatmullRomCurve3([
      v3(s*.141,.054+flock+front*.107,-.104+c*.115),
      v3(s*.143,.143+flock,-.109+c*.115),
      v3(s*.089,.216+flock*.64,-.123+c*.082),
      v3(s*.056,.167,-.187+c*.039),
      v3(s*.055,.071,-.222+c*.023)
    ]);
    const set=sets[i%sets.length],samples=18;
    for(let k=0;k<=samples;k++){
      const t=k/samples,p=path.getPoint(t),tangent=path.getTangent(t);
      const radial=v3(p.x,p.y-.09,p.z+.10).normalize();
      const side=tangent.cross(radial).normalize();
      const width=(.0029+Math.abs(fly)*.21)*(.28+.72*sin(PI*t)**.62);
      const n=set.points.length/3;
      for(const across of [-1,0,1]){
        const q=p.clone().addScaledVector(side,across*width).addScaledVector(radial,across===0?.0017:0);
        set.points.push(...q.toArray());
      }
      if(k)set.faces.push(n-3,n,n-2,n,n+1,n-2,n-2,n+1,n-1,n+1,n+2,n-1);
    }
  }
  sets.forEach((set,i)=>{
    const g=new T.BufferGeometry();
    g.setAttribute('position',new T.Float32BufferAttribute(set.points,3));g.setIndex(set.faces);g.computeVertexNormals();
    hair[i].side=T.DoubleSide;mesh(g,hair[i],root);
  });
}
function buildHead(parent) {
  const root=group(parent,0,1.624,.102);
  root.scale.set(.86,.85,.89);
  const face=mesh(geometry,faceMat,root);
  if(!faceMat.map)loadSkin(faceMat);
  const eyes=[];
  for(const s of [-1,1]) {
    const ear=ellipsoid(root,scalp,s*.145,-.021,-.104,.022,.043,.027);
    ear.rotation.z=s*-.25;ear.rotation.y=s*.35;
    const earFold=ellipsoid(root,skin,s*.154,-.020,-.084,.010,.024,.006);
    earFold.rotation.z=s*-.25;
    ellipsoid(root,buckle,s*.148,-.058,-.088,.0065,.009,.0055);
  }
  eyesLoops.forEach(loop=>eyes.push(buildEye(root,loop)));
  const hairBase=ellipsoid(root,hair[0],0,.128,-.119,.143,.095,.094);
  hairBase.rotation.x=-.2;
  const bun=ellipsoid(root,hair[1],.006,.065,-.224,.067,.062,.044);
  bun.rotation.z=.14;
  crown(root);groom(root);
  for(let i=0;i<15;i++) {
    const a=i/15*PI*2;
    line(root,hair[i%hair.length],[v3(.005,.101,-.218),v3(cos(a)*.060,.065+sin(a)*.057,-.241),v3(cos(a)*.035,.062+sin(a)*.037,-.263),v3(.007,.062,-.267)],.0025,4);
  }
  return {root,face,eyes};
}

function arm(parent,s) {
  const upper=group(parent,s*.179,1.322,.038); upper.rotation.z=s*.15;
  cloth(upper,dress,[[.091,.008,.009,0],[.069,.049,.047,0],[.037,.072,.067,0],[-.016,.076,.073,0],[-.105,.062,.059,0],[-.22,.056,.051,0]],PI*2,0,.005);
  const fore=group(upper,0,-.215,0);
  cloth(fore,dress,[[.019,.057,.055,0],[-.10,.048,.046,0],[-.196,.036,.036,0]],PI*2,0,.005);
  cloth(fore,lace,[[-.184,.041,.041,0],[-.209,.039,.037,0]],PI*2,0,.004);
  const hand=group(fore,0,-.233,0);
  ellipsoid(hand,skin,0,0,0,.035,.05,.024);
  for(let i=0;i<4;i++) {
    const x=(i-1.5)*.016;
    line(hand,skin,[v3(x,-.019,.002),v3(x,-.05,.014),v3(x*.8,-.065,.031)],.008,6);
  }
  line(hand,skin,[v3(s*.025,0,0),v3(s*.036,-.019,.024),v3(s*.025,-.037,.035)],.009);
  return {upper,fore,hand};
}

export function createCaretaker() {
  const root=new T.Group();
  const body=group(root);
  const left=arm(body,-1),right=arm(body,1);
  const skirt=cloth(body,dress,[[.18,.294,.201,-.036],[.39,.264,.172,-.035],[.69,.209,.143,-.022],[.93,.153,.117,0],[1.06,.142,.109,.018]],PI*2,0,.027);
  cloth(body,dress,[[.96,.144,.115,.016],[1.08,.151,.116,.026],[1.21,.17,.132,.039],[1.31,.181,.106,.041],[1.38,.131,.085,.055],[1.431,.069,.063,.089]],PI*2,0,.008);
  const apronLower=cloth(body,apron,[[.29,.302,.213,-.028],[.54,.243,.173,-.02],[.84,.19,.145,.005],[1.01,.154,.133,.012]],1.98,-.99,.018);
  cloth(body,apron,[[.985,.154,.147,.029],[1.08,.169,.143,.037],[1.22,.166,.156,.051],[1.306,.148,.135,.053]],1.33,-.665,.004);
  cloth(body,lace,[[.983,.155,.131,.011],[1.018,.154,.132,.016]],PI*2,0,.003);
  ellipsoid(body,buckle,0,1.01,.147,.048,.025,.012);
  ellipsoid(body,skin,0,1.478,.087,.057,.103,.055);
  cloth(body,lace,[[1.431,.072,.065,.089],[1.457,.067,.061,.088],[1.475,.063,.058,.088]],PI*2,0,.001);
  ellipsoid(body,buckle,0,1.452,.153,.009,.010,.005);
  for(let i=0;i<5;i++)ellipsoid(body,buckle,0,1.12+i*.057,.184-i*.006,.009,.009,.007);
  const boots=[-1,1].map(s=>{
    const boot=group(root,s*.105,.04,-.036);
    const shin=ellipsoid(root,dark,s*.105,.25,-.03,.045,.22,.046);
    ellipsoid(boot,shoe,0,.018,.044,.055,.048,.093);
    ellipsoid(boot,shoe,0,-.014,.05,.060,.024,.111);
    return {boot,shin,s};
  });
  const poker=group(right.hand,0,-.031,.035);poker.rotation.x=PI*.41;
  mesh(new T.CylinderGeometry(.013,.014,.73,9),metal,poker,0,-.31,0);
  mesh(new T.CylinderGeometry(.019,.019,.14,10),shoe,poker,0,.012,0);
  line(poker,metal,[v3(0,-.62,0),v3(0,-.69,0),v3(.018,-.71,0),v3(.065,-.69,0)],.012);
  const head=buildHead(body);
  let stride=0,energy=0,attackTime=0,wasAttack=false,cloak=0;
  function animate(dt,time,pace=0,mode='idle',gaze=0) {
    const damping=T.MathUtils.damp;
    energy=damping(energy,pace,6,dt);
    if(mode==='attack'){if(!wasAttack)attackTime=0;attackTime+=dt;}
    else attackTime=0;
    wasAttack=mode==='attack';
    const attack=mode==='attack'?T.MathUtils.smoothstep(attackTime,0,.28):0;
    const strike=mode==='attack'?T.MathUtils.smoothstep(attackTime,.30,.56):0;
    if(energy>.025)stride+=dt*(2.2+energy*10.2);
    const swing=sin(stride)*Math.min(energy,.99), twist=cos(stride)*energy;
    body.position.y=energy*(.008+.019*(1-cos(stride*2)))+sin(time*2.1)*.003;
    body.rotation.set(.026+energy*.10+strike*.12,swing*.072,twist*.033);
    boots.forEach(({boot,shin,s},i)=>{
      const phase=(stride/(2*PI)+i*.5)%1,stance=phase<.63;
      const t=stance?phase/.63:(phase-.63)/.37;
      const span=.21*Math.min(energy,1.15);
      const y=stance?0:sin(t*PI)**1.1*energy*.11;
      const z=span*(stance?1-2*t:2*T.MathUtils.smoothstep(t,0,1)-1);
      boot.position.set(s*.105,.039+y,-.044+z);
      boot.rotation.x=stance?0:-sin(t*PI*2)*energy*.21;
      const ankle=v3(boot.position.x,boot.position.y+.036,boot.position.z);
      const knee=v3(s*.103,.409+body.position.y,-.03+z*.31);
      shin.position.copy(ankle).lerp(knee,.5);
      shin.scale.y=knee.distanceTo(ankle)*.54;
      shin.quaternion.setFromUnitVectors(v3(0,1,0),knee.sub(ankle).normalize());
    });
    cloak=damping(cloak,-swing*.09+strike*.035,10,dt);
    skirt.rotation.set(cloak,twist*.028,-swing*.023);
    apronLower.rotation.copy(skirt.rotation);
    left.upper.rotation.x=-swing*.47-attack*.57+strike*.16;
    right.upper.rotation.x=swing*.34-attack*2.05+strike*1.33-.10;
    left.fore.rotation.x=-.20-Math.max(0,swing)*.28;
    right.fore.rotation.x=-.25-attack*.38+strike*.29;
    right.upper.rotation.z=.17+attack*.43-strike*.25;
    const scanning=mode==='search'||mode==='alert';
    head.root.rotation.y=damping(head.root.rotation.y,gaze+(scanning?sin(time*3.4)*.29:sin(time*1.1)*.065),6,dt);
    head.root.rotation.x=-.10+sin(time*1.7)*.026-attack*.26+strike*.21;
    head.root.rotation.z=sin(time*1.2)*.042-attack*.13;
    head.face.morphTargetInfluences[0]=.05+sin(time*2.6)*.028+strike*.84;
    const blink=Math.max(0,1-Math.abs((time%5.9)-3.8)*20);
    head.face.morphTargetInfluences[1]=blink*.94;
    head.face.morphTargetInfluences[2]=scanning?.29:attack*.68;
    head.eyes.forEach(e=>{e.morphTargetInfluences[0]=blink*.94;});
    eyeSurface.offset.x=-Math.sin(head.root.rotation.y)*.26;
  }
  return {root,animate};
}
