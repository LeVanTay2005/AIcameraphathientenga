// A conservative posture heuristic, not a clinically validated classifier.
export class FallDetector {
  constructor(){this.uprightAt=-Infinity;this.horizontalAt=null;this.lastTrigger=-Infinity;}
  update(points,time,width=1,height=1){
    if(!points||![11,12,23,24].every(i=>points[i]&&(points[i].visibility??1)>.6)){this.horizontalAt=null;return false;}
    const shoulder={x:(points[11].x+points[12].x)/2*width,y:(points[11].y+points[12].y)/2*height};
    const hip={x:(points[23].x+points[24].x)/2*width,y:(points[23].y+points[24].y)/2*height};
    const dx=Math.abs(shoulder.x-hip.x),dy=Math.abs(shoulder.y-hip.y);
    if(dy>dx*1.6){this.uprightAt=time;this.horizontalAt=null;return false;}
    if(dx>dy*1.4&&time-this.uprightAt<4500){
      this.horizontalAt??=time;
      if(time-this.horizontalAt>800&&time-this.lastTrigger>20000){this.lastTrigger=time;this.uprightAt=-Infinity;this.horizontalAt=null;return true;}
    }else this.horizontalAt=null;
    return false;
  }
}
