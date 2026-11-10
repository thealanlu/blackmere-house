import {stalkerSettings,patrolPoints,PRE_LAYOUT_RUN_VERSION,RUN_VERSION} from './rules.js';
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));

export function createStalker(world,nav,brain,random,emit,openDoor,attack,version=RUN_VERSION) {
  const actor=brain.actor;
  const safeHiding=version>PRE_LAYOUT_RUN_VERSION;
  let level=stalkerSettings(brain.difficulty??'normal',version);
  function setState(next,point=null,delay=0) {
    brain.state=next;brain.goal=point;brain.timer=delay;brain.repath=0;brain.waypoints=[];
  }
  function reset(which,day) {
    brain.difficulty=which;level=stalkerSettings(which,version);brain.gaze=0;actor.x=-7.7;actor.z=-9;brain.spawnTime=level.grace;
    brain.heading=Math.PI/2;brain.pace=0;brain.stride=.5;brain.doorWait=0;
    brain.lastNoise=null;brain.remembered=null;brain.seen=0;brain.check=null;brain.searchPoints=[];
    brain.patrol=day%2?[...patrolPoints]:[...patrolPoints].reverse();
    brain.stage=brain.patrol.findIndex(p=>p[0]===0&&p[1]===-9);
    setState('patrol',brain.patrol[brain.stage]);

  }
  function hear(x,z,r) {
    const distance=Math.hypot(x-actor.x,z-actor.z);
    const damping=nav.clear(actor.x,actor.z,x,z)?1:.71;
    const strength=r*level.hearing*damping-distance;
    if(brain.spawnTime<=0&&strength>0&&strength>(brain.lastNoise?.strength??0))brain.lastNoise={point:[x,z],strength};
  }
  function startSearch(point) {
    const [x,z]=point;
    const spot=safeHiding?null:world.hiding.filter(o=>Math.hypot(o.x-x,o.z-z)<2.8)
      .sort((a,b)=>Math.hypot(a.x-x,a.z-z)-Math.hypot(b.x-x,b.z-z))[0];
    brain.check=spot&&random()<level.inspect?spot.index:null;
    brain.searchPoints=[[x+.9,z-.9],[x-1.15,z+.67],[x+.5,z+1.8]].filter(([a,b])=>!nav.blocked(a,b,.24,true));
    const approach=brain.check!==null?[spot.x+Math.sin(spot.yaw)*.52,spot.z+Math.cos(spot.yaw)*.52]:null;
    setState('search',approach??brain.searchPoints.shift()??point,5.5);
  }
  function canSee(player,distance,targetHeading) {
    return player&&brain.spawnTime<=0&&!player.hidden&&distance<level.vision*(player.crouch?.72:1)&&
      (distance<1.68||Math.abs(wrap(targetHeading-brain.heading))<(brain.state==='chase'?1.73:1.03))&&
      nav.clear(actor.x,actor.z,player.x,player.z);
  }
  function chooseTarget(players) {
    let best=null,score=Infinity;
    for(const player of players) {
      if(safeHiding&&player.hidden)continue;
      const dx=player.x-actor.x,dz=player.z-actor.z,distance=Math.hypot(dx,dz);
      const visible=canSee(player,distance,Math.atan2(dx,dz));
      const value=distance+(visible?0:100);
      if(value<score){score=value;best=player;}
    }
    return best;
  }
  function recover() {
    brain.recovering=.90;brain.pace=0;
  }
  function update(dt,player) {
    if(brain.state==='attack') {
      if(brain.recovering===undefined)return;
      if((brain.recovering-=dt)>0)return;
      delete brain.recovering;
      startSearch([actor.x,actor.z]);
    }
    brain.spawnTime-=dt;brain.timer-=dt;brain.doorWait=Math.max(0,brain.doorWait-dt);
    const dx=player?player.x-actor.x:0,dz=player?player.z-actor.z:0,distance=player?Math.hypot(dx,dz):Infinity;
    const targetHeading=Math.atan2(dx,dz);
    const visible=canSee(player,distance,targetHeading);
    if(visible) {
      brain.seen+=dt*(distance<3?2.5:1);
      if(brain.seen>.22||brain.state==='chase') {
        brain.remembered=[player.x,player.z];
        if(brain.state!=='chase'){brain.check=null;setState('chase',brain.remembered,3);}
        else {brain.goal=brain.remembered;brain.timer=3;}
      }
    } else brain.seen=Math.max(0,brain.seen-dt*.8);
    const reachedGoal=radius=>!brain.goal||Math.hypot(brain.goal[0]-actor.x,brain.goal[1]-actor.z)<radius;
    if(brain.state==='chase'&&!visible&&(reachedGoal(.48)||brain.timer<=0))startSearch(brain.remembered);
    if(brain.lastNoise&&brain.state!=='chase') {
      const {point}=brain.lastNoise;
      if(brain.state==='alert'||brain.state==='investigate') {
        // Keep moving toward a series of sounds. Replan on the regular route timer.
        brain.goal=point;
        if(brain.state==='investigate')brain.timer=9;
      } else {
        brain.check=null;setState('alert',point,.42);
      }
    }
    brain.lastNoise=null;
    if(brain.state==='alert'&&brain.timer<=0)setState('investigate',brain.goal,9);
    if(distance<.87&&visible) {
      brain.heading=targetHeading;setState('attack');
      attack(actor);return;
    }
    let arrived=reachedGoal(.44);
    if(brain.state==='investigate'&&(arrived||brain.timer<=0)) {
      startSearch(brain.goal);
      arrived=reachedGoal(.44);
    }
    if(brain.state==='search') {
      if(!safeHiding&&brain.check!==null&&arrived) {
        const spot=world.objects[brain.check];
        const x=spot.x+Math.sin(spot.yaw)*.15,z=spot.z+Math.cos(spot.yaw)*.15;
        const accessible=nav.clear(actor.x,actor.z,x,z);
        if(accessible&&spot.panels)world.setContainer(spot,true);
        if(accessible&&player?.hidden===spot) {
          brain.heading=targetHeading;setState('attack');attack(actor);return;
        }
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
    let moveHeading=brain.heading,travelled=0;
    if(brain.goal&&brain.state!=='alert'&&!(brain.state==='search'&&arrived)) {
      brain.repath-=dt;
      const direct=brain.state==='chase'&&distance<3.3&&visible&&!nav.blocked(player.x,player.z,.23)&&
        nav.clear(actor.x,actor.z,player.x,player.z,.23);
      if(direct){brain.waypoints=[brain.goal];brain.repath=0;}
      else if(brain.repath<=0) {
        brain.waypoints=nav.path(actor.x,actor.z,...brain.goal);
        brain.repath=brain.state==='chase'?.32:.79;
      }
      while(brain.waypoints.length>1&&Math.hypot(actor.x-brain.waypoints[0][0],actor.z-brain.waypoints[0][1])<.17&&
        nav.clear(actor.x,actor.z,...brain.waypoints[1],.23,true))brain.waypoints.shift();
      const next=brain.waypoints[0];
      if(next) {
        const x=next[0]-actor.x,z=next[1]-actor.z,d=Math.hypot(x,z);
        moveHeading=Math.atan2(x,z);
        if(d>.025&&brain.doorWait===0) {
          const alignment=Math.max(0,Math.cos(wrap(moveHeading-brain.heading)));
          const velocity=brain.state==='chase'?level.chase:brain.state==='search'?level.walk*.73:level.walk;
          const reach=Math.min(.63,d)/d;
          const door=alignment>.65?nav.doorAhead(actor.x,actor.z,x*reach,z*reach):null;
          if(door) {
            openDoor(door,true,true);brain.doorWait=.23;
          } else {
            const speed=Math.min(d,velocity*alignment*dt);
            const {x:beforeX,z:beforeZ}=actor;
            nav.move(actor,x/d*speed,z/d*speed,.23);
            travelled=Math.hypot(actor.x-beforeX,actor.z-beforeZ);
          }
        }
      }
    }
    if(brain.state==='alert'&&brain.goal)moveHeading=Math.atan2(brain.goal[0]-actor.x,brain.goal[1]-actor.z);
    brain.heading+=wrap(moveHeading-brain.heading)*Math.min(1,dt*(brain.state==='chase'?11:5));
    brain.pace=travelled/(dt*3.4);

    brain.gaze=visible?Math.max(-.45,Math.min(.45,wrap(targetHeading-brain.heading))):0;
    const running=brain.state==='chase';
    const previousStride=brain.stride;
    brain.stride+=travelled/(running?.99:.76);
    if(Math.floor(brain.stride)>Math.floor(previousStride))emit('enemyStep',{...actor,running,foot:Math.floor(brain.stride)%2});
  }
  return {update,reset,hear,chooseTarget,recover};
}
