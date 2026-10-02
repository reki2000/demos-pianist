import base64,struct,json,bisect
from pathlib import Path
ROOT=Path(__file__).parent
def read_midi(path):
 b=base64.b64decode(path.read_text()); fmt,ntr,ppq=struct.unpack('>HHH',b[8:14]); pos=14; events=[]; names=[]; tempos=[(0,500000)]
 def vlq(data,p):
  val=0
  while True:
   c=data[p];p+=1;val=(val<<7)|(c&127)
   if c<128:return val,p
 for tr in range(ntr):
  length=struct.unpack('>I',b[pos+4:pos+8])[0];data=b[pos+8:pos+8+length];pos+=8+length;p=0;tick=0;running=0;name=''
  while p<len(data):
   dt,p=vlq(data,p);tick+=dt;status=data[p]
   if status>=128:p+=1
   else:status=running
   if status==255:
    kind=data[p];p+=1;n,p=vlq(data,p);v=data[p:p+n];p+=n
    if kind==81:tempos.append((tick,int.from_bytes(v,'big')))
    if kind==3:name=v.decode('latin1')
    continue
   if status in (240,247):n,p=vlq(data,p);p+=n;continue
   running=status;kind=status>>4;ch=status&15;a=data[p];p+=1;d=0
   if kind not in (12,13):d=data[p];p+=1
   if kind in (8,9,11):events.append((tick,tr,ch,kind,a,d))
  names.append(name)
 tempos=sorted(dict(tempos).items());ts=[];tt=[];now=0;prev=0;tempo=500000
 for tick,t in tempos:now+=(tick-prev)*tempo/ppq/1e6;ts.append(tick);tt.append(now);prev=tick;tempo=t
 def seconds(tick):
  i=bisect.bisect_right(ts,tick)-1
  return tt[i]+(tick-ts[i])*tempos[i][1]/ppq/1e6
 active={};notes=[];pedals=[]
 for tick,tr,ch,k,a,d in sorted(events):
  key=(tr,ch,a)
  if k==9 and d>0:
   if key in active:
    start,vel=active.pop(key);notes.append([start,seconds(tick)-start,a,vel,tr,ch])
   active[key]=(seconds(tick),d)
  elif k in (8,9) and key in active:
   start,vel=active.pop(key);notes.append([start,max(.02,seconds(tick)-start),a,vel,tr,ch])
  elif k==11 and a==64:pedals.append([seconds(tick),d])
 print(path.name,names,sorted({(n[4],n[5]) for n in notes}))
 return sorted(notes),pedals,names
def main():
 choices=json.loads((ROOT/'choices.json').read_text());songs=[]
 for id,title,composer,opus,path in choices:
  notes,pedals,names=read_midi(ROOT/f'raw-{id}.b64')
  # The source MIDI channels 0 and 1 encode right and left hands respectively.
  lefttracks={i for i,name in enumerate(names) if 'left' in name.lower()}
  if id=='prelude':notes=[n for n in notes if n[4] in (1,2)]
  result=[]
  for t,d,p,v,tr,ch in notes:
   hand=1 if (tr in lefttracks if lefttracks else p<60) else 0
   result.append([round(t,5),round(d,5),p,v,hand])
  # Assign fingers in ordered attack clusters. Held notes retain their assigned finger.
  assigned=[]
  for hand in [0,1]:
   seq=[n for n in result if n[4]==hand];used=[(-1,60 if hand==0 else 48) for _ in range(5)];i=0
   while i<len(seq):
    cluster=[];t=seq[i][0]
    while i<len(seq) and seq[i][0]<t+.022:cluster.append(seq[i]);i+=1
    cluster.sort(key=lambda n:n[2]);free=list(range(5))
    for j,n in enumerate(cluster):
     candidates=[f for f in free if used[f][0]<=t+.02] or free
     if not candidates:candidates=list(range(5))
     preferred=(round(j*4/max(1,len(cluster)-1)) if len(cluster)>1 else min(range(5),key=lambda f:abs(used[f][1]-n[2])))
     f=min(candidates,key=lambda f:abs(used[f][1]-n[2])*.4+abs(f-preferred)*1.5+max(0,used[f][0]-t)*20)
     if f in free:free.remove(f)
     used[f]=(n[0]+n[1],n[2]);assigned.append(n+[f])
  assigned.sort();songs.append(dict(id=id,title=title,composer=composer,opus=opus,notes=assigned,pedals=pedals,duration=round(max(n[0]+n[1] for n in assigned)+2,3)))
 (ROOT/'dist/songs.js').write_text('window.SONGS='+json.dumps(songs,ensure_ascii=False,separators=(',',':'))+';',encoding='utf8')
 print([(s['id'],len(s['notes']),s['duration']) for s in songs])
if __name__=='__main__':main()
