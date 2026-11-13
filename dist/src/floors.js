// The east wing rises in two pairs of stairs. Coordinates stay continuous for movement and pathfinding.
export const stairs=[
  {from:'main',to:'upper',x0:14,x1:23,z:-2.5,y:0},
  {from:'main',to:'upper',x0:14,x1:23,z:8,y:0},
  {from:'upper',to:'attic',x0:36,x1:45,z:-2.5,y:3.4},
  {from:'upper',to:'attic',x0:36,x1:45,z:8,y:3.4},
  {from:'upper',to:'attic',x0:36,x1:45,z:10.65,y:3.4,secret:true}
];
export const stairWidth=2.2;
export const wingRooms=[
  {name:'Family Library',floor:'upper',x0:23,x1:31.65,z0:-8,z1:2},
  {name:'East Bedrooms',floor:'upper',x0:23,x1:31.65,z0:2,z1:12},
  {name:'Family Room',floor:'upper',x0:31.65,x1:36,z0:-8,z1:2},
  {name:'Washroom',floor:'upper',x0:31.65,x1:36,z0:2,z1:12},
  {name:'Attic Workshop',floor:'attic',x0:45,x1:58,z0:-8,z1:2},
  {name:'Attic Storage',floor:'attic',x0:45,x1:58,z0:2,z1:12}
];
export const wingPatrol=[[26,-5],[33,-4],[32,8],[49,8],[52,-4],[29,-5]];
export const floors=[
  {id:'cellar',code:'B1',label:'Basement',x0:7.2,x1:14.3,z0:-13,z1:-5.12},
  {id:'main',code:'1F',label:'Ground floor',x0:-14,x1:18.5,z0:-13,z1:13},
  {id:'upper',code:'2F',label:'Second floor',x0:18.5,x1:40.5,z0:-8,z1:12},
  {id:'attic',code:'3F',label:'Attic',x0:40.5,x1:58,z0:-8,z1:12}
];
