import {clamp} from './rules.js';

export const HIDE_EXIT_TICKS=13;
const wrap=a=>Math.atan2(Math.sin(a),Math.cos(a));
export const hideHeading=spot=>wrap(spot.yaw+Math.PI);

export function limitHideLook(player,spot) {
  const heading=hideHeading(spot);
  player.yaw=wrap(heading+clamp(wrap(player.yaw-heading),-spot.look,spot.look));
  player.pitch=clamp(player.pitch,-.26,.25);
}

export function peekSees(spot,x,z) {
  const [vx,,vz]=spot.view;
  const heading=Math.atan2(vx-x,vz-z);
  return Math.abs(wrap(heading-hideHeading(spot)))<=spot.look+.52;
}
