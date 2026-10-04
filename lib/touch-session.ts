export type TouchPoint={id:number;x:number;y:number};
/** Owns a complete contact sequence; lifting one finger never starts a new tap. */
export class TouchSession{
  points=new Map<number,TouchPoint>();
  private origins=new Map<number,TouchPoint>();
  private start=0;private maxContacts=0;private moved=0;private consumed=false;
  down(point:TouchPoint,time:number){if(!this.points.size){this.origins.clear();this.start=time;this.maxContacts=0;this.moved=0;this.consumed=false}this.points.set(point.id,point);this.origins.set(point.id,point);this.maxContacts=Math.max(this.maxContacts,this.points.size)}
  move(point:TouchPoint){if(!this.points.has(point.id))return;const origin=this.origins.get(point.id)!;this.moved=Math.max(this.moved,Math.hypot(point.x-origin.x,point.y-origin.y));this.points.set(point.id,point)}
  get multiple(){return this.maxContacts>1}
  consume(){this.consumed=true}
  snapshot(){const points=[...this.points.values()];return {count:points.length,x:points.reduce((v,p)=>v+p.x,0)/(points.length||1),y:points.reduce((v,p)=>v+p.y,0)/(points.length||1),distance:points.length===2?Math.hypot(points[0].x-points[1].x,points[0].y-points[1].y):0}}
  up(id:number,time:number,cancel=false):'tap'|'undo'|null{if(cancel)this.consume();this.points.delete(id);if(this.points.size)return null;if(this.consumed||this.moved>7)return null;const duration=time-this.start;if(this.maxContacts===1&&duration<350)return 'tap';if(this.maxContacts===2&&duration<240)return 'undo';return null}
  reset(){this.consume();this.points.clear();this.origins.clear()}
}
