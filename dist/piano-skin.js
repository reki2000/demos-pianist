'use strict';
// Shared B fingers/palm, with a shorter articulated thumb, mirrored for piano.
// This adapter reuses all storage and only reads the musical motion's joints.
window.PianoHandSkin=(()=>{
  const states=new WeakMap();
  function create(hand){const mesh=ViolinFingerSkin.create(false,true,hand===1);mesh.thumb.radii=[.012,.0085,.0065];mesh.thumb.skinBaseT=.65;return {mesh,hand:{palmPos:[0,0,0],wrist:[0,0,0],basis:[[0,0,0],[0,0,0],[0,0,0]],fingers:Array.from({length:4},()=>({points:Array.from({length:4},()=>[0,0,0])})),thumb:Array.from({length:4},()=>[0,0,0])}};}
  function update(state,H,hand){
    const P=H.palm,B=state.hand.basis,c=Math.cos(P.yaw||0),s=Math.sin(P.yaw||0),cp=Math.cos(P.pitch||0),sp=Math.sin(P.pitch||0),sign=hand?1:-1;
    B[0][0]=c*sign;B[0][1]=0;B[0][2]=-s*sign;
    B[1][0]=s*cp;B[1][1]=-sp;B[1][2]=c*cp;
    B[2][0]=s*sp;B[2][1]=cp;B[2][2]=c*sp;
    const unit=PianoMotion.worldScale,origin=PianoMotion.handPoint(P,[0,0,0]),wrist=PianoMotion.handPoint(P,[0,0,-.035/unit]);
    for(let k=0;k<3;k++){state.hand.palmPos[k]=origin[k]*unit;state.hand.wrist[k]=wrist[k]*unit;}
    for(let f=0;f<4;f++)for(let j=0;j<4;j++)for(let k=0;k<3;k++)state.hand.fingers[f].points[j][k]=H.fingers[hand?3-f:f+1].points[j][k]*unit;
    for(let j=0;j<4;j++)for(let k=0;k<3;k++)state.hand.thumb[j][k]=H.fingers[hand?4:0].points[j][k]*unit;
    return ViolinFingerSkin.update(state.mesh,state.hand);
  }
  function draw(R,H,hand,color){let pair=states.get(R);if(!pair){pair=[create(0),create(1)];states.set(R,pair);}R.dynamicMesh('piano-hand-'+hand,update(pair[hand],H,hand),color);}
  return {create,update,draw};
})();
