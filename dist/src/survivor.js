import * as T from '../vendor/three.module.js';
import {createCaretaker} from './caretaker.js';

const palettes=[
  [0x3d4a40,0x272e33,0x9d6851,0x30241d],
  [0x4d3741,0x262b2d,0xbd9071,0x201d19],
  [0x354959,0x363a34,0x815947,0x2a2021],
  [0x6a5038,0x313037,0xb78560,0x29211b]
];
const materials=new Map(),sphere=new T.SphereGeometry(1,16,12),cube=new T.BoxGeometry(1,1,1);
const compactSphere=new T.SphereGeometry(1,10,7);
function material(color) {
  if(!materials.has(color))materials.set(color,new T.MeshStandardMaterial({color,roughness:.88}));
  return materials.get(color);
}
function shape(parent,geometry,color,x,y,z,sx,sy,sz) {
  const mesh=new T.Mesh(geometry,material(color));
  mesh.position.set(x,y,z);mesh.scale.set(sx,sy,sz);mesh.castShadow=true;parent.add(mesh);
  return mesh;
}
const oval=(p,c,x,y,z,a,b,d)=>shape(p,sphere,c,x,y,z,a,b,d);
const block=(p,c,x,y,z,a,b,d)=>shape(p,cube,c,x,y,z,a,b,d);
function pivot(parent,x,y,z) {
  const group=new T.Group();group.position.set(x,y,z);parent.add(group);return group;
}

export function survivorModel(index) {
  const [coat,slacks,skin,hair]=palettes[index%palettes.length];
  const root=new T.Group(),body=pivot(root,0,0,0);
  oval(body,coat,0,1.21,0,.26,.38,.149);
  oval(body,coat,0,1.02,-.024,.225,.14,.143);
  oval(body,0x2b2926,0,1.49,0,.134,.085,.132);
  block(body,0x322f29,0,1.15,.138,.025,.44,.015);
  for(const side of [-1,1]) {
    block(body,0x262a27,side*.18,1.16,.119,.091,.106,.016).rotation.z=side*.11;
  }
  const head=pivot(body,0,1.59,.013);
  oval(head,skin,0,.085,0,.116,.147,.110);
  oval(head,skin,0,.039,.03,.087,.079,.089);
  oval(head,skin,0,.065,.10,.022,.033,.033);
  for(const s of [-1,1]){
    oval(head,skin,s*.112,.082,-.003,.022,.037,.025);
    oval(head,0x252523,s*.045,.103,.10,.023,.011,.012);
    oval(head,0x302822,s*.046,.124,.094,.024,.006,.013);
  }
  oval(head,hair,0,.164,-.017,.119,.084,.113);
  oval(head,hair,0,.096,-.066,.117,.113,.060);
  if(index%4===1)oval(head,hair,0,.13,-.126,.079,.087,.057);
  if(index%4===3)oval(head,hair,0,.024,.047,.093,.042,.062);
  const legs=[],arms=[];
  for(const side of [-1,1]) {
    const leg=pivot(body,side*.12,.93,0);
    const knee=pivot(leg,0,-.43,0),ankle=pivot(knee,0,-.43,0);
    legs.push({leg,knee,ankle});
    oval(leg,slacks,0,-.23,0,.104,.273,.105);
    oval(knee,slacks,0,-.19,.005,.083,.237,.079);
    oval(ankle,0x242722,0,.005,.050,.082,.075,.147);
    const arm=pivot(body,side*.247,1.39,.005);arms.push(arm);
    oval(arm,coat,side*.026,-.19,0,.086,.229,.088);
    oval(arm,coat,side*.037,-.45,.029,.073,.165,.076);
    oval(arm,skin,side*.039,-.586,.039,.059,.082,.059);
    if(side===1)block(arm,0x232522,.040,-.575,.086,.077,.070,.17);
  }
  return {root,detail(low){
    root.traverse(node=>{if(node.geometry===sphere||node.geometry===compactSphere)node.geometry=low?compactSphere:sphere;});
  },pose(pose,time,dt) {
    const damp=T.MathUtils.damp;
    const kneel=pose.status==='captured',crouch=pose.crouch||kneel;
    const bend=kneel?1.14:crouch?.92:0;
    body.position.y=damp(body.position.y,-.86*(1-Math.cos(bend)),12,dt);
    body.rotation.x=damp(body.rotation.x,crouch?.10:pose.pace*.045,12,dt);
    head.rotation.x=damp(head.rotation.x,-pose.pitch*.50,12,dt);
    const swing=Math.sin(pose.stride*Math.PI)*Math.min(pose.pace,.99);
    for(let i=0;i<2;i++) {
      const direction=i===0?-1:1;
      const {leg,knee,ankle}=legs[i];
      leg.rotation.x=damp(leg.rotation.x,direction*swing*.57-bend,15,dt);
      knee.rotation.x=damp(knee.rotation.x,bend*2+Math.max(0,direction*swing)*.32,15,dt);
      ankle.rotation.x=damp(ankle.rotation.x,crouch?-bend:0,15,dt);
      arms[i].rotation.x=damp(arms[i].rotation.x,-direction*swing*.50-(i===1?.17:0),15,dt);
      arms[i].rotation.z=direction*(.055+Math.sin(time*2)*.012);
    }
  }};
}

export function roomPreview(canvas) {
  const renderer=new T.WebGLRenderer({canvas,antialias:false,alpha:true,powerPreference:'low-power'});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.4));
  renderer.outputColorSpace=T.SRGBColorSpace;
  const scene=new T.Scene(),camera=new T.PerspectiveCamera(32,1,.1,25);
  camera.position.set(0,1.15,4.15);camera.lookAt(0,.93,0);
  scene.add(new T.HemisphereLight(0xffe6be,0x423329,2.3));
  const rim=new T.DirectionalLight(0xc3e0dd,1.55);rim.position.set(-2,3,-1);scene.add(rim);
  const model=survivorModel(0),hunter=createCaretaker();
  scene.add(model.root,hunter.root);
  return {
    dispose(){renderer.dispose();},
    draw(angle,granny) {
      const w=canvas.clientWidth,h=canvas.clientHeight;
      if(!w||!h)return;
      if(canvas.width!==Math.floor(w*renderer.getPixelRatio())||canvas.height!==Math.floor(h*renderer.getPixelRatio())) {
        renderer.setSize(w,h,false);camera.aspect=w/h;camera.updateProjectionMatrix();
      }
      model.root.visible=!granny;hunter.root.visible=granny;
      const root=granny?hunter.root:model.root;
      root.rotation.y=angle;renderer.render(scene,camera);
    }
  };
}
