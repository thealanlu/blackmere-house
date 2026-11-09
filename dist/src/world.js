import * as T from '../vendor/three.module.js';
import { mat, materials as m, rng } from './materials.js';

import {floorY,itemInfo} from './rules.js';

export function createWorld(scene) {
  const solid=[], doors=[], objects=[], lights=[], hiding=[], items=[], staticShapes=new Map();
  const rngWorld=rng(83415);
  const w=new T.Group();scene.add(w);
  const boxGeo=new T.BoxGeometry(1,1,1);
  const dummy=new T.Object3D();
  const toRad=Math.PI/2;
  function box(x,y,z,dx,dy,dz,material,parent=null,angle=0) {
    if(parent) {
      const o=new T.Mesh(boxGeo,material);o.scale.set(dx,dy,dz);o.position.set(x,y,z);o.rotation.y=angle;
      o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
    }
    if(!staticShapes.has(material))staticShapes.set(material,[]);
    staticShapes.get(material).push([x,y,z,dx,dy,dz,angle]);
  }
  function cylinder(parent,material,x,y,z,top,bottom,height,n=12) {
    const o=new T.Mesh(new T.CylinderGeometry(top,bottom,height,n),material);
    o.position.set(x,y,z);o.castShadow=true;o.receiveShadow=true;parent.add(o);return o;
  }
  const prop=(x,y,z)=>{const o=new T.Group();o.position.set(x,y,z);w.add(o);return o;};
  function obstacle(x,z,dx,dz) {const o={x,z,dx,dz};solid.push(o);return o;}
  function surface(x,y,z,width,height,material,u,v,rx=0,ry=0) {
    const geo=new T.PlaneGeometry(width,height);
    const uv=geo.attributes.uv;
    for(let i=0;i<uv.count;i++)uv.setXY(i,uv.getX(i)*u,uv.getY(i)*v);
    const o=new T.Mesh(geo,material);o.position.set(x,y,z);o.rotation.set(rx,ry,0,'YXZ');o.receiveShadow=true;w.add(o);
  }
  function panel(axis,fixed,a,b,kind) {
    if(b-a<.02)return;
    const horiz=axis==='x', center=(a+b)/2, length=b-a;
    const basement=kind==='stone';
    const x=horiz?center:fixed,z=horiz?fixed:center;
    const bottom=basement?-1.19:0;
    const h=3.38-bottom;
    obstacle(x,z,horiz?length:.22,horiz?.22:length);
    box(x,bottom+h/2,z,horiz?length:.19,h,horiz?.19:length,basement?m.stone:m.trim);
    for(const sign of [-1,1]) {
      const off=sign*.105;
      const side=horiz?(sign>0?0:Math.PI):(sign>0?toRad:-toRad);
      surface(horiz?x:x+off,bottom+h/2,horiz?z+off:z,length,h,basement?m.stone:m.wall,length/2.35,h/3.4,0,side);
    }
    if(basement)return;
    box(x,.535,z,horiz?length:.255,1.07,horiz?.255:length,m.darkWood);
    for(const [y,d] of [[.08,.14],[.99,.12],[1.08,.045],[3.29,.13],[3.18,.044]]) {
      box(x,y,z,horiz?length:.32,d,horiz?.32:length,m.trim);
    }
    for(let p=a+.55;p<b-.32;p+=.95) {
      for(const sign of [-1,1]) {
        box(horiz?p:fixed+sign*.13,.54,horiz?fixed+sign*.13:p,horiz?.69:.026,.60,horiz?.026:.69,m.wood);
      }
    }
  }
  function doorway(axis,fixed,center,options={}) {
    const horiz=axis==='x', width=options.width??1.52, bottom=options.bottom??0;
    const x=horiz?center:fixed,z=horiz?fixed:center;
    const frame=prop(x,bottom,z);if(!horiz)frame.rotation.y=toRad;
    const material=options.secret?m.darkWood:options.metal?m.iron:m.darkWood;
    for(const s of [-1,1]) {
      box(s*(width/2+.075),1.13,0,.14,2.3,.31,material,frame);
      box(s*(width/2+.17),1.13,0,.047,2.3,.335,m.trim,frame);
    }
    box(0,2.31,0,width+.34,.22,.35,material,frame);
    box(0,2.88,0,width,1.0,.22,options.metal?m.stone:m.wall,frame);
    if(options.openPassage)return;
    const pivot=new T.Group();pivot.position.x=-width/2;frame.add(pivot);
    box(width/2,1.103,0,width-.06,2.205,.115,material,pivot);
    for(const s of [-1,1]) {
      if(options.secret) {
        for(let y=.45;y<2.19;y+=.49) {
          box(width/2,y,s*.102,width-.05,.09,.16,m.wood,pivot);
          for(let k=0;k<8;k++) {
            const ht=.18+rngWorld()*.19;
            box(.13+k*(width-.22)/8,y+.05+ht/2,s*.12,.075+rngWorld()*.045,ht,.12,bookColors[k%bookColors.length],pivot,rngWorld()*.08);
          }
        }
      } else {
        for(const y of [.47,1.18,1.78]) {
          box(width/2,y,s*.063,width-.30,.43,.04,m.wood,pivot);
          box(width/2,y,s*.084,width-.44,.32,.018,material,pivot);
        }
        box(width-.185,1.04,s*.08,.105,.21,.025,m.iron,pivot);
        const handle=cylinder(pivot,m.brass,width-.185,1.05,s*.118,.035,.04,.075);
        handle.rotation.x=toRad;
      }
    }
    const blocker={x,z,dx:horiz?width:.20,dz:horiz?.20:width,enabled:true};
    solid.push(blocker);
    const d={x,z,y:bottom+1.14,pivot,blocker,open:false,angle:0,name:options.name??'Door',kind:options.exit?'front':'door',
      secret:options.secret,width,axis,action:options.exit?'Inspect front door':'Open door'};
    if(options.exit) {
      d.chain=prop(x,1.12,z-.13);
      for(let i=0;i<17;i++) {
        const link=new T.Mesh(new T.TorusGeometry(.051,.012,7,10),m.iron);
        link.position.set((i-8)*.078,Math.sin(i/16*Math.PI)*-.16,0);
        link.scale.x=1.25;link.rotation.x=i%2?Math.PI/3:0;d.chain.add(link);
      }
      box(.04,-.19,-.04,.16,.18,.09,m.brass,d.chain);
    }
    doors.push(d);objects.push(d);return d;
  }
  function partition(axis,fixed,a,b,openings=[],kind) {
    let p=a;
    for(const [center,opt] of openings) {
      const width=opt.width??1.52;
      panel(axis,fixed,p,center-width/2,kind);
      doorway(axis,fixed,center,opt);
      p=center+width/2;
    }
    panel(axis,fixed,p,b,kind);
  }
  const bookColors=[mat(0x59463a),mat(0x383f36),mat(0x67483b),mat(0x4c504b),mat(0x403536),mat(0x665b44)];
  partition('x',-13,-14,14);
  partition('x',13,-14,14,[[0,{name:'Front Door',exit:true,width:1.85}]]);
  partition('z',-14,-13,13);
  partition('z',14,-13,-5,[[-8.9,{name:'Drain Exit',openPassage:true,width:1.67,bottom:-1.15,metal:true}]],'stone');
  partition('z',14,-5,13);
  partition('z',-2.25,-13,13,[[-8.7,{name:'Study Door'}],[-.8,{name:'Music Room Door'}],[8.3,{name:'Bedroom Door'}]]);
  partition('z',2.25,-13,13,[[-8.7,{name:'Cellar Door',metal:true}],[-1.1,{name:'Kitchen Door'}],[8.3,{name:'Drawing Room Door'}]]);
  partition('x',-5,-14,-2.25,[[-10.6,{name:'Pivoting Bookcase',secret:true,width:1.65}]]);
  partition('x',3.8,-14,-2.25);
  partition('x',-5,2.25,14,[],'stone');
  partition('x',3.8,2.25,14,[[10.6,{name:'Service Arch',openPassage:true,width:1.65}]]);
  function flatFloor(x0,x1,z0,z1,material,y=0) {
    surface((x0+x1)/2,y,(z0+z1)/2,x1-x0,z1-z0,material,(x1-x0)/2.9,(z1-z0)/3.5,-toRad);
  }
  flatFloor(-14,2.25,-13,13,m.floor);
  flatFloor(2.25,14,3.8,13,m.floor);
  flatFloor(2.25,14,-5,3.8,m.tile);
  flatFloor(2.25,5.6,-13,-5,m.stone);
  flatFloor(8.8,14,-13,-5,m.stone,-1.15);
  const ramp=new T.PlaneGeometry(3.2,8,16,1);
  ramp.rotateX(-toRad);ramp.translate(7.2,0,-9);
  const pos=ramp.attributes.position;
  for(let i=0;i<pos.count;i++)pos.setY(i,floorY(pos.getX(i),-7));
  ramp.computeVertexNormals();
  const slope=new T.Mesh(ramp,m.stone);slope.receiveShadow=true;w.add(slope);
  surface(0,3.4,0,28,26,m.ceiling,9,9,toRad);
  for(let z=-12;z<13;z+=2.6)box(0,3.22,z,4.61,.24,.20,m.darkWood);
  for(const x of [-9.1,8.4]) for(let z=-11.4;z<12;z+=3.6)box(x,3.27,z,11.35,.19,.19,m.darkWood);
  surface(0,.017,.6,1.94,20.5,m.rug,1,4,-toRad);
  surface(-8.2,.016,-.2,4.7,5.5,m.rug,1,1,-toRad);
  surface(8.1,.016,8.3,4.5,5.7,m.rug,1,1,-toRad);
  flatFloor(-16,16,13,35,m.stone,-.08);
  for(const side of [-1,1])for(let i=0;i<13;i++) {
    const x=side*(2.8+rngWorld()*8),z=15+rngWorld()*17,h=3.5+rngWorld()*4;
    box(x,h/2,z,.16,h,.22,m.trim,null,rngWorld());
    box(x+.19,h*.79,z,.087,h*.48,.12,m.trim,null,rngWorld());
  }
  for(let i=0;i<5;i++) {
    box(15+i*1.45,-1.2,-8.9,1.5,.15,1.84,m.stone);
    box(15+i*1.45,.15,-9.83,1.5,2.79,.18,m.stone);
    box(15+i*1.45,.15,-7.97,1.5,2.79,.18,m.stone);
    box(15+i*1.45,1.53,-8.9,1.5,.18,1.83,m.stone);
  }

  function sconce(x,z,angle,cold=false) {
    const o=prop(x,2.38,z);o.rotation.y=angle;
    box(0,-.06,0,.21,.37,.065,m.iron,o);
    box(0,-.17,.16,.12,.058,.31,m.brass,o);
    cylinder(o,m.brass,0,-.14,.29,.146,.09,.055);
    cylinder(o,cold?m.cold:m.glow,0,.01,.29,.10,.135,.24);
    cylinder(o,m.iron,0,.14,.29,.076,.123,.055);
    lights.push({x:x+Math.sin(angle)*.46,y:2.28,z:z+Math.cos(angle)*.46,color:cold?0xa7d6e3:0xffbd7f,power:cold?16:19,flicker:rngWorld()*8});
  }
  sconce(-2.10,10,toRad);sconce(2.1,4.1,-toRad);sconce(-2.10,-3.6,toRad);sconce(2.1,-11,-toRad);
  sconce(-13.84,6,toRad);sconce(-13.84,-.4,toRad);sconce(-5,-12.86,0);
  sconce(13.82,8,-toRad);sconce(13.8,-3.4,-toRad);sconce(13.8,-10.2,-toRad,true);
  sconce(8.8,-12.82,0,true);
  function windowFrame(x,z,a) {
    const o=prop(x,2.09,z);o.rotation.y=a;
    box(0,0,0,1.48,1.64,.105,m.darkWood,o);
    box(0,0,.066,1.22,1.41,.06,m.glass,o);
    for(const i of [-1,0,1])box(i*.405,0,.116,.035,1.42,.045,m.trim,o);
    box(0,-.11,.112,1.28,.05,.05,m.trim,o);
    box(0,-.84,.155,1.6,.10,.33,m.wood,o);
    for(const s of [-1,1])for(let i=0;i<6;i++) {
      const h=1.24+Math.sin(i*.5)*.26;
      const curtain=box(s*(.61+i*.09),.75-h/2,.18+Math.sin(i*1.8)*.06,.114,h,.07,m.red,o);
      curtain.rotation.z=s*(i*.023-.07);
    }
    lights.push({x:x+Math.sin(a)*.92,y:2.19,z:z+Math.cos(a)*.92,color:0x8cb9c7,power:13,flicker:0});
  }
  windowFrame(-10,12.85,Math.PI);windowFrame(9,12.85,Math.PI);windowFrame(-13.86,-2.3,toRad);windowFrame(-10.3,-12.85,0);
  function frameArt(x,z,a,style) {
    if(!globalThis.document)return;
    const o=prop(x,1.99,z);o.rotation.y=a;
    box(0,0,0,1.08,1.34,.09,m.darkWood,o);
    box(0,0,.055,.96,1.21,.04,m.brass,o);
    const canvas=Object.assign(document.createElement('canvas'),{width:144,height:184});
    const g=canvas.getContext('2d'),r=rng(style+71);
    const gradient=g.createRadialGradient(70,77,1,74,91,112);
    gradient.addColorStop(0,'#726454');gradient.addColorStop(1,'#221b18');g.fillStyle=gradient;g.fillRect(0,0,144,184);
    g.fillStyle='#343330';g.beginPath();g.ellipse(72,147,50,48,0,0,7);g.fill();
    g.fillStyle='#ad9480';g.beginPath();g.ellipse(70,71,27,37,-.14,0,7);g.fill();
    g.fillStyle='#38332b';g.beginPath();g.ellipse(71,55,30,26,-.14,Math.PI,Math.PI*2);g.fill();
    for(const x of [60,82]){g.fillStyle='#454139';g.fillRect(x,69,7,3);}
    g.fillStyle='#6b514a';g.fillRect(63,91,15,2);
    for(let i=0;i<2100;i++){g.fillStyle=i%3?'#20150d33':'#a2988531';g.fillRect(r()*144,r()*184,r()*2+1,r()*4);}
    const tex=new T.CanvasTexture(canvas);tex.colorSpace=T.SRGBColorSpace;
    const painting=new T.Mesh(new T.PlaneGeometry(.88,1.14),mat(0xffffff,{map:tex}));
    painting.position.z=.082;o.add(painting);
  }
  frameArt(-2.09,5.55,toRad,1);frameArt(2.09,.65,-toRad,2);frameArt(-7.3,-12.86,0,3);
  frameArt(13.85,10.3,-toRad,4);frameArt(-2.09,-11.3,toRad,5);

  function dresser(x,z,angle,name='Drawer') {
    const o=prop(x,0,z);o.rotation.y=angle;
    box(0,.44,0,1.72,.74,.68,m.darkWood,o);
    box(0,.87,0,1.89,.10,.77,m.wood,o);
    for(const s of [-1,1])for(const t of [-1,1])box(s*.74,.13,t*.26,.12,.24,.12,m.trim,o);
    const drawer=new T.Group();drawer.position.set(0,.70,.349);o.add(drawer);
    box(0,0,-.19,1.51,.125,.42,m.wood,drawer);
    box(0,.06,.02,1.61,.19,.065,m.wood,drawer);
    box(0,.06,.069,.15,.043,.035,m.brass,drawer);
    for(const y of [.29,.48]) {
      box(0,y,.352,1.61,.15,.065,m.wood,o);box(0,y,.40,.15,.042,.032,m.brass,o);
    }
    obstacle(x,z,Math.abs(Math.cos(angle))>.5?1.79:.73,Math.abs(Math.cos(angle))>.5?.73:1.79);
    const obj={kind:'drawer',x:x+Math.sin(angle)*.43,y:.74,z:z+Math.cos(angle)*.43,drawer,name,open:false};
    objects.push(obj);return obj;
  }
  function wardrobe(x,z,angle,hide=true) {
    const o=prop(x,0,z);o.rotation.y=angle;
    box(0,1.15,-.38,1.67,2.26,.09,m.darkWood,o);
    for(const s of [-1,1])box(s*.82,1.15,0,.115,2.29,.84,m.wood,o);
    box(0,2.29,0,1.82,.16,.98,m.trim,o);box(0,.11,0,1.74,.22,.84,m.darkWood,o);
    if(!hide)box(0,1.05,0,1.52,.093,.78,m.wood,o);
    const panels=[];
    for(const s of [-1,1]) {
      const p=new T.Group();p.position.set(s*.76,0,.43);o.add(p);panels.push(p);
      box(-s*.38,1.19,0,.745,2.14,.085,m.wood,p);
      for(const y of [.59,1.59])box(-s*.38,y,.047,.54,.76,.047,m.darkWood,p);
      box(-s*.64,1.16,.072,.049,.14,.049,m.brass,p);
    }
    obstacle(x,z,Math.abs(Math.cos(angle))>.5?1.79:.86,Math.abs(Math.cos(angle))>.5?.86:1.79);
    const obj={kind:hide?'hide':'cabinet',type:'wardrobe',x:x+Math.sin(angle)*.46,y:1.16,z:z+Math.cos(angle)*.46,
      anchor:[x,z],yaw:angle,panels,name:hide?'Wardrobe':'Wall Cabinet',open:false};
    objects.push(obj);if(hide)hiding.push(obj);
    return obj;
  }
  function table(x,z,dx,dz,h=.84,tableMat=m.wood,y=0) {
    const o=prop(x,y,z);
    box(0,h,0,dx,.105,dz,tableMat,o);box(0,h-.124,0,dx-.14,.17,dz-.11,m.darkWood,o);
    for(const s of [-1,1])for(const t of [-1,1]) {
      cylinder(o,m.wood,s*(dx/2-.14),h*.46,t*(dz/2-.12),.052,.074,h*.88,9);
    }
    obstacle(x,z,dx,dz);return o;
  }
  function chair(x,z,a) {
    const o=prop(x,0,z);o.rotation.y=a;
    box(0,.48,0,.48,.085,.46,m.darkWood,o);
    box(0,.53,0,.42,.07,.40,m.red,o);
    for(const s of [-1,1])for(const t of [-1,1])box(s*.181,t>0?.25:.56,t*.185,.06,t>0?.49:1.12,.06,m.wood,o);
    box(0,1.055,-.19,.43,.14,.083,m.wood,o);
    for(const i of [-1,0,1])box(i*.1,.84,-.19,.033,.38,.036,m.darkWood,o);
    obstacle(x,z,.46,.46);
  }
  function book(x,y,z,a=0,c=0) {
    box(x,y,z,.30,.043,.43,bookColors[c%bookColors.length],null,a);
    box(x,y+.004,z,.273,.027,.386,m.paper,null,a);
  }
  function crate(x,z,dx=.8,dz=.7,h=.6) {
    const y=floorY(x,z),o=prop(x,y,z);
    box(0,h/2,0,dx,h,dz,m.wood,o);
    for(const i of [-1,1]) {
      box(i*(dx/2-.07),h*.5,dz*.51,.085,h,.07,m.darkWood,o);
      box(0,i*(h*.42)+h*.5,dz*.515,dx,.085,.07,m.darkWood,o);
    }
    obstacle(x,z,dx,dz);
  }
  function carpetSign(text,x,y,z,a=0,color='#ddd1b9') {
    if(!globalThis.document)return;
    const c=Object.assign(document.createElement('canvas'),{width:512,height:96});
    const g=c.getContext('2d');g.fillStyle='#27251f';g.fillRect(0,0,512,96);
    g.strokeStyle='#827257';g.lineWidth=4;g.strokeRect(10,10,492,76);
    g.font='42px Georgia';g.textAlign='center';g.textBaseline='middle';g.fillStyle=color;g.fillText(text,256,51);
    const t=new T.CanvasTexture(c);t.colorSpace=T.SRGBColorSpace;
    const o=new T.Mesh(new T.PlaneGeometry(1.24,.233),mat(0xffffff,{map:t,emissive:0x4a4539,emissiveIntensity:.18}));
    o.position.set(x,y,z);o.rotation.y=a;w.add(o);
  }
  carpetSign('WEST BEDROOM',-2.077,2.61,8.3,toRad);
  carpetSign('MUSIC ROOM',-2.077,2.61,-.8,toRad);
  carpetSign('STUDY',-2.077,2.61,-8.7,toRad);
  carpetSign('DRAWING ROOM',2.077,2.61,8.3,-toRad);
  carpetSign('KITCHEN',2.077,2.61,-1.1,-toRad);
  carpetSign('CELLAR',2.077,2.61,-8.7,-toRad);
  carpetSign('FRONT DOOR',0,2.61,12.80,Math.PI);

  const bed=prop(-10.7,0,9.6);
  box(0,.47,0,1.95,.19,3.06,m.darkWood,bed);
  box(0,.65,0,1.85,.23,2.88,m.linen,bed);
  box(0,.79,-.37,1.91,.082,2.05,m.green,bed);
  box(0,.56,-1.33,1.95,1.13,.145,m.wood,bed);
  box(0,.83,-.91,.93,.16,.5,m.linen,bed,-.04);
  for(const s of [-1,1]) for(const t of [-1,1]) {
    cylinder(bed,m.wood,s*.91,.39,t*1.39,.068,.10,t<0?1.29:.67);
  }
  obstacle(-10.7,9.6,1.97,3.04);
  const underBed={kind:'hide',type:'bed',x:-10.7,y:.52,z:11.21,anchor:[-10.7,9.94],yaw:0,name:'Under the Bed'};
  objects.push(underBed);hiding.push(underBed);
  const keyDrawer=dresser(-5.3,11.99,Math.PI,'Bedroom Drawer');
  const keyDrawerB=dresser(-12.92,7.12,toRad,'Nightstand');
  wardrobe(-5.0,4.35,0);
  table(-12.7,11.7,.76,.72);book(-12.7,.923,11.65,.22,2);

  const studyDesk=table(-8.3,-11.16,2.57,1.05);
  box(0,.12,.0,.26,.22,.34,m.iron,studyDesk);
  book(-8.8,.925,-11.2,.14,4);book(-8.55,.974,-11.23,-.32,1);
  chair(-8.32,-10.13,Math.PI-.11);
  const toolCab=wardrobe(-13.37,-9.25,toRad,false);
  wardrobe(-5.03,-12.48,0);
  const toolTable=table(-4.56,-6.3,.87,.77);
  for(const x of [-12.7,-10.9]) {
    const shelf=prop(x,0,-12.45);
    box(0,1.32,-.2,1.64,2.64,.14,m.darkWood,shelf);
    for(const s of [-1,1])box(s*.79,1.32,0,.09,2.64,.46,m.wood,shelf);
    for(let i=0;i<5;i++) {
      const y=.31+i*.47;box(0,y,0,1.56,.07,.46,m.wood,shelf);
      for(let j=0;j<9;j++) {
        const ht=.16+rngWorld()*.24;
        box(-.68+j*.16,y+.035+ht/2,.02,.085+rngWorld()*.064,ht,.25,bookColors[(i+j)%6],shelf,.07*rngWorld());
      }
    }
    obstacle(x,-12.45,1.66,.52);
  }

  const piano=prop(-12.43,0,.58);piano.rotation.y=toRad;
  box(0,.85,0,2.24,1.7,.65,m.darkWood,piano);
  box(0,.91,.37,2.18,.19,.57,m.wood,piano);
  for(let i=0;i<29;i++) {
    box(-1+i*.07,1.018,.52,.063,.024,.27,m.linen,piano);
    if(i%7!==2&&i%7!==6)box(-.972+i*.07,1.039,.45,.029,.025,.14,m.black,piano);
  }
  obstacle(-12.43,.58,.89,2.24);chair(-11.47,.6,1.57);
  const crateHide=wardrobe(-4.85,3.21,Math.PI);
  crateHide.name='Music Room Closet';
  table(-8.75,1.95,1.37,.75);chair(-9.62,1.76,1.3);

  const sofa=prop(11.89,0,11.25);
  box(0,.44,0,3.1,.49,1.06,m.red,sofa);
  box(0,.85,.42,3.12,.79,.24,m.red,sofa);
  for(const s of [-1,1])box(s*1.39,.7,0,.28,.58,1.14,m.red,sofa);
  for(let i=-1;i<=1;i++)box(i*.87,.71,-.068,.83,.19,.83,m.red,sofa);
  obstacle(11.89,11.25,3.15,1.1);
  const crankCab=wardrobe(13.43,5.58,-toRad,false);crankCab.name='Drawing Room Cabinet';
  wardrobe(4.8,12.44,Math.PI);
  const crankTable=table(7.4,11.72,1.27,.89);
  table(9.65,6.09,1.65,.91,.58);chair(7.5,6.3,-1.28);chair(10.35,5.01,-.36);
  box(12.35,.63,9.45,1.13,1.26,.22,m.stone);box(12.35,1.31,9.45,1.61,.17,.49,m.wood);
  box(12.35,.51,9.29,.69,.92,.04,m.black);

  const fuseBench=table(10.31,-3.86,3.18,1.15,1.01,m.darkWood);
  box(1.18,1.13,.03,.34,.18,.31,m.iron,fuseBench);
  const fuseCab=dresser(13.25,-1.05,-toRad,'Pantry Drawer');
  table(6.25,1.58,2.13,1.14);chair(5.21,2.51,2.5);chair(7.48,1.39,-1.38);
  for(const x of [4.5,5.5,6.5])crate(x,-4.26,.81,.72,.55+rngWorld()*.4);
  for(const [x,z,h] of [[3.45,-12,.69],[11.1,-12.28,.85],[13,-11.78,.84],[9.28,-6.1,.74],[12.1,-6,.51]])crate(x,z,1.02,.91,h);
  const fuseBox={kind:'fusebox',x:11.9,y:.29,z:-12.54,name:'Cellar Fuse Box'};
  const electrical=prop(fuseBox.x,fuseBox.y,-12.83);
  box(0,0,0,.63,.78,.24,m.iron,electrical);
  box(0,0,.138,.51,.64,.06,m.black,electrical);
  box(0,-.1,.18,.31,.14,.05,m.iron,electrical);
  fuseBox.lamp=box(0,.181,.182,.18,.077,.033,m.rust,electrical);
  box(0,.86,-.044,.047,1.11,.052,m.iron,electrical);
  objects.push(fuseBox);
  const hatch={kind:'hatch',x:13.46,y:.06,z:-8.9,name:'Drain Gate'};
  const drain=prop(13.81,-.18,-8.9);drain.rotation.y=-toRad;
  const gate=new T.Group();drain.add(gate);
  box(0,-.15,0,1.67,2.32,.19,m.iron,gate);
  for(const s of [-1,1])box(s*.76,-.15,.15,.13,2.34,.14,m.rust,drain);
  for(let i=-4;i<=4;i++)box(i*.15,-.2,.13,.049,1.76,.074,m.iron,gate);
  box(0,.97,.19,1.74,.16,.25,m.rust,drain);
  const gateWheel=new T.Mesh(new T.TorusGeometry(.232,.032,8,24),m.rust);
  gateWheel.position.set(0,.22,.228);drain.add(gateWheel);
  box(0,.22,.23,.35,.045,.049,m.iron,drain);
  box(0,.22,.23,.045,.35,.049,m.iron,drain);
  hatch.wheel=gateWheel;objects.push(hatch);
  const gateBlock={x:13.9,z:-8.9,dx:.20,dz:1.67,enabled:true};
  solid.push(gateBlock);
  carpetSign('STORM DRAIN',13.59,1.21,-8.9,-toRad);

  function note(x,y,z,title,body) {
    box(x,y,z,.27,.014,.37,m.paper,null,.27);
    objects.push({kind:'note',x,y:y+.02,z,name:title,body});
  }
  note(-12.7,.907,11.91,'Torn Note','Five nights. That is how long she said I would last. The front door has a chain and an old brass lock. I left a key in the bedroom. The bolt cutters were last seen in the study.');
  note(10.64,1.075,-3.83,'Maintenance Slip','The drain gate runs on the cellar panel. Replace the porcelain fuse from the kitchen, then fit the missing winch handle. I left the handle upstairs in the drawing room.');
  note(-8.14,.905,-11.15,'Housekeeper’s Note','The bookcase between the study and music room swings on a hinge. Move slowly. She comes to check every dropped thing.');
  function makeItem(id) {
    const o=prop(0,0,0);
    const ring=(x,y,z,r,t,material)=>{const a=new T.Mesh(new T.TorusGeometry(r,t,8,22),material);a.position.set(x,y,z);a.rotation.x=toRad;o.add(a);};
    if(id==='key') {ring(-.12,.025,0,.058,.018,m.brass);box(.045,.025,0,.26,.023,.035,m.brass,o);box(.13,.025,.045,.046,.023,.09,m.brass,o);}
    if(id==='cutters') {
      for(const s of [-1,1]) {
        box(s*.049,.035,.012,.035,.036,.35,m.rust,o,s*.25);
        box(s*.026,.031,-.186,.054,.054,.13,m.iron,o,-s*.2);
      }
      cylinder(o,m.iron,0,.037,-.113,.046,.044,.043);
    }
    if(id==='fuse') {
      for(const z of [-.094,0,.094]) {
        const barrel=cylinder(o,z?m.brass:m.linen,0,.039,z,.041,.041,z?.058:.15);barrel.rotation.x=toRad;
      }
    }
    if(id==='crank') {
      box(0,.047,0,.36,.052,.063,m.iron,o);box(-.159,.052,.095,.06,.063,.23,m.iron,o);
      box(.151,.052,-.063,.072,.069,.16,m.rust,o);
    }
    const i={kind:'item',id,name:itemInfo[id].name,mesh:o,x:0,y:0,z:0,available:true};
    items.push(i);objects.push(i);return i;
  }
  const itemSpots={
    key:[keyDrawer,keyDrawerB],
    cutters:[toolCab,{x:toolTable.position.x,y:.91,z:toolTable.position.z}],
    fuse:[fuseCab,{x:fuseBench.position.x-.57,y:1.069,z:fuseBench.position.z}],
    crank:[crankCab,{x:crankTable.position.x,y:.91,z:crankTable.position.z}]
  };
  Object.keys(itemSpots).forEach(makeItem);
  function setContainer(o,open) {
    o.open=open;
    if(o.drawer)o.drawer.position.z=open?.59:.349;
    if(o.panels)o.panels.forEach((p,i)=>{p.rotation.y=open?(i===0?1:-1)*1.03:0;});
  }
  const animated=new Set([gate,gateWheel,fuseBox.lamp,...items.map(i=>i.mesh),...doors.flatMap(d=>[d.pivot,d.chain]),...objects.flatMap(o=>[o.drawer,...(o.panels??[])])]);
  w.updateMatrixWorld(true);
  const fixed=[];
  w.traverse(o=>{
    if(o.geometry!==boxGeo)return;
    for(let node=o;node&&node!==w;node=node.parent)if(animated.has(node))return;
    o.matrixWorld.decompose(dummy.position,dummy.quaternion,dummy.scale);
    if(!staticShapes.has(o.material))staticShapes.set(o.material,[]);
    staticShapes.get(o.material).push([
      dummy.position.x,dummy.position.y,dummy.position.z,dummy.scale.x,dummy.scale.y,dummy.scale.z,dummy.rotation.y,
      dummy.rotation.x,dummy.rotation.z
    ]);
    fixed.push(o);
  });
  fixed.forEach(o=>o.removeFromParent());
  for(const [material,instances] of staticShapes) {
    const instance=new T.InstancedMesh(boxGeo,material,instances.length);
    instances.forEach(([x,y,z,dx,dy,dz,a,rx=0,rz=0],i)=>{
      dummy.position.set(x,y,z);dummy.scale.set(dx,dy,dz);dummy.rotation.set(rx,a,rz);
      dummy.updateMatrix();instance.setMatrixAt(i,dummy.matrix);
    });
    instance.receiveShadow=true;instance.castShadow=true;w.add(instance);
  }
  let gateTarget=0;
  return {root:w,solid,doors,objects,lights,hiding,items,itemSpots,gateBlock,setContainer,
    power(on){fuseBox.lamp.material=on?m.cold:m.rust;hatch.wheel.rotation.z=on?.5:0;},
    openGate(on){gateBlock.enabled=!on;gateTarget=on?2.3:0;if(!on)gate.position.y=0;},
    updateGate(dt){gate.position.y=T.MathUtils.damp(gate.position.y,gateTarget,4,dt);}
  };
}
