import {levels,patrolPoints} from './rules.js';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

export function createStalker(world,nav,brain,random,emit,openDoor,attack) {
  const actor=brain.actor;
  let level=levels[brain.difficulty??'normal'];
  function setState(next,point=null,delay=0) {
    brain.state=next;brain.goal=point;brain.timer=delay;brain.repath=0;brain.waypoints=[];
  }
  function reset(which,day) {
    brain.difficulty=which;level=levels[which];brain.gaze=0;actor.x=-7.7;actor.z=-9;brain.spawnTime=level.grace;
    brain.heading=Math.PI/2;brain.pace=0;brain.step=.33;brain.lastNoise=null;brain.remembered=null;brain.seen=0;brain.check=null;brain.searchPoints=[];
    brain.patrol=day%2?[...patrolPoints]:[...patrolPoints].reverse();
    brain.stage=brain.patrol.findIndex(p=>p[0]===0&&p[1]===-9);
    setState('patrol',brain.patrol[brain.stage]);

  }
  function hear(x,z,r) {
    const distance=Math.hypot(x-actor.x,z-actor.z);
    const damping=nav.clear(actor.x,actor.z,x,z)?1:.71;
    if(brain.spawnTime<=0&&distance<r*level.hearing*damping)brain.lastNoise=[x,z];
  }
  function startSearch(point) {
    const [x,z]=point;
    brain.check=world.hiding.find(o=>Math.hypot(o.x-x,o.z-z)<2.8&&random()<level.inspect)?.index??null;
    brain.searchPoints=[[x+.9,z-.9],[x-1.15,z+.67],[x+.5,z+1.8]].filter(([a,b])=>!nav.blocked(a,b,.24,true));
    setState('search',brain.check!==null?[world.objects[brain.check].x,world.objects[brain.check].z]:brain.searchPoints.shift()??point,5.5);
  }
  function update(dt,player) {
    if(brain.state==='attack')return;
    brain.spawnTime-=dt;brain.timer-=dt;
    const dx=player.x-actor.x,dz=player.z-actor.z,distance=Math.hypot(dx,dz);
    const targetHeading=Math.atan2(dx,dz);
    const clear=distance<level.vision&&nav.clear(actor.x,actor.z,player.x,player.z);
    const visible=brain.spawnTime<=0&&!player.hidden&&clear&&
      (distance<1.68||Math.abs(wrap(targetHeading-brain.heading))<(brain.state==='chase'?1.73:1.03))&&
      distance<level.vision*(player.crouch?.72:1);
    if(visible) {
      brain.seen+=dt*(distance<3?2.5:1);
      if(brain.seen>.22||brain.state==='chase') {
        brain.remembered=[player.x,player.z];
        if(brain.state!=='chase')setState('chase',brain.remembered,2.25);
        else {brain.goal=brain.remembered;brain.timer=2.25;}
      }
    } else brain.seen=Math.max(0,brain.seen-dt*.8);
    if(brain.state==='chase'&&brain.timer<=0&&brain.remembered) startSearch(brain.remembered);
    if(brain.lastNoise&&brain.state!=='chase')setState('alert',brain.lastNoise,.42);
    brain.lastNoise=null;
    if(brain.state==='alert'&&brain.timer<=0)setState('investigate',brain.goal,9);
    if(distance<.87&&visible&&nav.clear(actor.x,actor.z,player.x,player.z)) {
      brain.heading=targetHeading;setState('attack');
      attack(actor);return;
    }
    let arrived=!brain.goal||Math.hypot(brain.goal[0]-actor.x,brain.goal[1]-actor.z)<(brain.check!==null?1.02:.44);
    if(brain.state==='investigate'&&(arrived||brain.timer<=0))startSearch(brain.goal);
    if(brain.state==='search') {
      if(brain.check!==null&&arrived) {
        if(player.hidden===world.objects[brain.check]) {
          if(world.objects[brain.check].panels)world.setContainer(world.objects[brain.check],true);
          brain.heading=targetHeading;setState('attack');attack(actor);return;
        }
        if(world.objects[brain.check].panels)world.setContainer(world.objects[brain.check],true);
        brain.check=null;
      }
      if(arrived&&brain.searchPoints.length&&brain.timer>1.6) {
        brain.goal=brain.searchPoints.shift();brain.repath=0;arrived=false;
      }
      if(brain.timer<=0) {
        brain.check=null;
        brain.stage=(brain.stage+1)%brain.patrol.length;setState('patrol',brain.patrol[brain.stage],10);
      }
    }
    if(brain.state==='patrol'&&(arrived||brain.timer<-12)) {
      brain.stage=(brain.stage+(random()<.16?2:1))%brain.patrol.length;
      setState('patrol',brain.patrol[brain.stage],8);
    }
    let moveHeading=brain.heading,velocity=0;
    if(brain.goal&&brain.state!=='alert'&&!(brain.state==='search'&&arrived)) {
      brain.repath-=dt;
      const direct=brain.state==='chase'&&distance<3.3&&visible&&!nav.blocked(player.x,player.z,.27,true);
      if(direct){brain.waypoints=[brain.goal];brain.repath=0;}
      else if(brain.repath<=0) {
        brain.waypoints=nav.path(actor.x,actor.z,...brain.goal);
        brain.repath=brain.state==='chase'?.32:.79;
      }
      while(brain.waypoints.length>1&&Math.hypot(actor.x-brain.waypoints[0][0],actor.z-brain.waypoints[0][1])<.25)brain.waypoints.shift();
      const next=brain.waypoints[0];
      if(next) {
        const x=next[0]-actor.x,z=next[1]-actor.z,d=Math.hypot(x,z);
        moveHeading=Math.atan2(x,z);
        if(d>.13) {
          velocity=brain.state==='chase'?level.chase:brain.state==='search'?level.walk*.73:level.walk;
          for(const door of world.doors) {
            if(door.kind==='door'&&!door.secret&&!door.open&&Math.hypot(door.x-actor.x,door.z-actor.z)<1.18)openDoor(door,true,true);
          }
          const speed=Math.min(d,velocity*dt);
          nav.move(actor,x/d*speed,z/d*speed,.23);
        }
      }
    }
    if(brain.state==='alert'&&brain.goal)moveHeading=Math.atan2(brain.goal[0]-actor.x,brain.goal[1]-actor.z);
    brain.heading+=wrap(moveHeading-brain.heading)*Math.min(1,dt*(brain.state==='chase'?11:5));
    brain.pace+=(velocity/3.4-brain.pace)*(1-Math.exp(-7*dt));

    brain.gaze=visible?Math.max(-.45,Math.min(.45,wrap(targetHeading-brain.heading))):0;
    brain.step-=dt;
    if(velocity>.2&&brain.step<=0){brain.step=velocity>2?.34:.62;emit('enemyStep',actor);}
  }
  return {update,reset,hear};
}
