export const clamp=(x,a,b)=>Math.max(a,Math.min(b,x));
export function smoothstep(x,a,b){const t=clamp((x-a)/(b-a),0,1);return t*t*(3-2*t);}
export const TICK=1/30;
export const RUN_VERSION=2;
export const MAX_TICKS=30*60*25;
export const levels={
  story:{label:'Story',caption:'Longer grace period and gentler pursuit.',walk:1.10,chase:2.22,vision:7.1,hearing:.75,grace:17,inspect:.32,points:1000},
  normal:{label:'Standard',caption:'She hears a careless step and remembers where you ran.',walk:1.42,chase:3.18,vision:10,hearing:1,grace:11,inspect:.68,points:1600},
  dread:{label:'Nightmare',caption:'Sharper hearing, a faster chase and frequent checks.',walk:1.75,chase:4.25,vision:12.8,hearing:1.3,grace:6,inspect:.92,points:2400}
};
export function runScore(difficulty,ticks,deaths,route){
  return route ? levels[difficulty].points + (5-deaths)*100 + Math.max(0,600-Math.floor(ticks/30))*2 : 0;
}
export const SPAWN = {x:-7.65,z:8.3,yaw:-Math.PI/2};
export const bounds = {x0:-14,x1:14,z0:-13,z1:13};
export const floorY = (x,z) => z < -5.12 ? -1.15*smoothstep(x,5.6,8.8) : 0;
export const areas=[
  ['West Bedroom',-14,-2.25,3.8,13],['Music Room',-14,-2.25,-5,3.8],
  ['Study',-14,-2.25,-13,-5],['Drawing Room',2.25,14,3.8,13],
  ['Kitchen',2.25,14,-5,3.8],['Cellar',2.25,14,-13,-5]
];
export const areaAt=(x,z)=>areas.find(([,a,b,c,d])=>x>a&&x<b&&z>c&&z<d)?.[0]??'Grand Hall';
export const itemInfo={
  key:{name:'Front Key',mark:'KEY',hint:'Look in the West Bedroom drawers.'},
  cutters:{name:'Bolt Cutters',mark:'CUT',hint:'The Study has a wall cabinet and a side table.'},
  fuse:{name:'Porcelain Fuse',mark:'FUS',hint:'Look around the Kitchen workbench and pantry.'},
  crank:{name:'Winch Handle',mark:'WIN',hint:'Search the Drawing Room cabinet and side table.'}
};
export const patrolPoints=[[-7.7,-9],[0,-9],[0,-1],[7,-1],[11,0],[11,7],[5.5,8],[0,9],[-7.5,8.3],[-8.4,-.8],[0,4.4],[4.3,-8.7],[10,-9]];

