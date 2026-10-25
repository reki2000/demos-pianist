'use strict';
window.PianoPedal=(()=>{
const clamp=(x,a,b)=>Math.max(a,Math.min(b,x)),smooth=x=>{x=clamp(x,0,1);return x*x*(3-2*x)};
function after(events,t){let lo=0,hi=events.length;while(lo<hi){let m=(lo+hi)>>1;if(events[m][0]<=t)lo=m+1;else hi=m}return lo}
function state(song,t){let i=after(song.pedals,t),value=i?song.pedals[i-1][1]/127:0,next=song.pedals[i],position=value;if(next&&next[0]-t<.06){let begin=Math.max(i?song.pedals[i-1][0]:0,next[0]-.06),u=smooth((t-begin)/Math.max(.000001,next[0]-begin));position=value+(next[1]/127-value)*u}return{value,position,down:value>=.5}}
function releaseMap(song){if(song.keyReleaseTimes)return song.keyReleaseTimes;let map=new Map();for(let hand of song.motion?.hands||[])for(let frame of hand.frames)for(let e of frame.notes)map.set(e.t.toFixed(6)+'/'+e.pitch,e.end);return song.keyReleaseTimes=map}
function keyEnd(song,n){return releaseMap(song).get(n[0].toFixed(6)+'/'+n[2])??n[0]+n[1]}
// Physical motion may lift the hand well before the next attack. Keep that
// timing for fingers, but do not turn the acoustic line into staccato.
const followingAttacks=new WeakMap();
function nextAttacks(song){
 if(followingAttacks.has(song))return followingAttacks.get(song);
 const following=new Map(),hands=[[],[]];
 for(const n of song.notes||[]){
  const groups=hands[n[4]===1?1:0],last=groups.at(-1);
  if(last&&n[0]-last.time<=.035)last.notes.push(n);
  else groups.push({time:n[0],notes:[n]});
 }
 for(const groups of hands)for(let i=0;i<groups.length-1;i++)
  for(const n of groups[i].notes)following.set(n,groups[i+1].time);
 followingAttacks.set(song,following);
 return following;
}
function soundEnd(song,n){
 const sourceEnd=n[0]+n[1],physicalEnd=keyEnd(song,n),end=Math.max(sourceEnd,physicalEnd);
 const next=nextAttacks(song).get(n),interval=next-n[0];
 // Connect neighboring attacks, not rests or deliberate very short notes.
 // A 28 ms overlap lets the new note speak before the previous damper closes.
 if(next!==undefined&&interval>.035&&interval<1.6&&n[1]>=interval*.20&&
    next-end<=Math.min(.42,interval*.82)&&next>=end-.04&&!state(song,next).down)
  return Math.max(end,next+.028);
 return end;
}
// Integrate string decay over physical key release and CC64 changes. Pedal-down
// at note-off matters even when the pedal was up at note-on. Re-pedalling can
// catch the remaining tail, but never restores energy already damped away.
function envelope(song,n,speed=1){let start=n[0]+.003*speed,end=Math.max(start+.003*speed,soundEnd(song,n)),horizon=Math.min(song.duration+.5*speed,n[0]+24*speed),points=[{t:n[0],level:0},{t:start,level:1}],changes=[end,horizon];let i=after(song.pedals,start),depth=i?song.pedals[i-1][1]/127:0;for(let j=i;j<song.pedals.length&&song.pedals[j][0]<horizon;j++)changes.push(song.pedals[j][0]);changes.sort((a,b)=>a-b);let tau=2.4+Math.max(0,72-n[2])*.09,level=1,time=start;
 for(let t of changes){if(t<=time)continue;let damping=time>=end-1e-8?(17+Math.max(0,n[2]-21)*.07)*Math.max(0,1-depth*2)**2:0,rate=1/tau+damping,dt=(t-time)/speed,stopDelta=Math.log(level/1e-5)/rate;if(stopDelta<=dt){points.push({t:time+Math.max(0,stopDelta)*speed,level:1e-5});return{points,end,keyEnd:end}}
  level*=Math.exp(-rate*dt);points.push({t,level:Math.max(1e-5,level)});time=t;let p=after(song.pedals,time);depth=p?song.pedals[p-1][1]/127:0;
 }
 points.push({t:horizon+.045*speed,level:1e-5});return{points,end,keyEnd:end};
}
function levelAt(profile,t){let p=profile.points;if(t<p[0].t||t>p.at(-1).t)return 0;let i=0;while(i+1<p.length&&p[i+1].t<=t)i++;if(i===p.length-1)return p[i].level;let a=p[i],b=p[i+1],u=(t-a.t)/(b.t-a.t);return a.level===0?b.level*u:a.level*Math.pow(b.level/a.level,u)}
return{state,envelope,levelAt,keyEnd,soundEnd};
})();
