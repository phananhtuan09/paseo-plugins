import json,sys,datetime as dt
def ts(s): return dt.datetime.fromisoformat(s.replace('Z','+00:00')).timestamp()
case=sys.argv[1]; f=f'/tmp/aa-spike/raw/{case}.jsonl'
rows=[json.loads(l) for l in open(f)]
t0=rows[0]['t']/1000
print(f'== {case}: {len(rows)} records, span {(rows[-1]["t"]/1000-t0):.0f}s')
lv=[r for r in rows if r['kind']=='live']
from collections import Counter
print('live event types:',dict(Counter(((r['message'].get('event') or {}).get('type') or r['message'].get('type')) for r in lv)))
calls={}
for r in rows:
    if r['kind']!='refetch': continue
    rel=r['t']/1000-t0
    for e in r['entries']:
        it=e['item']
        if it['type']!='tool_call': continue
        k=it['callId']; d=it.get('detail') or {}
        out=d.get('output') or d.get('log') or ''
        snap=(it['status'],len(out) if isinstance(out,str) else -1,e['timestamp'],d.get('type'))
        h=calls.setdefault(k,{'name':it['name'],'cmd':d.get('command') or d.get('input') or d.get('description'),'snaps':[]})
        if not h['snaps'] or h['snaps'][-1][1:]!=(snap):
            h['snaps'].append((round(rel,1),)+snap)
        h['err']=it.get('error'); h['meta']=it.get('metadata'); h['detailkeys']=sorted(d.keys()); h['exit']=d.get('exitCode')
for k,h in calls.items():
    print(f'-- {h["name"]} {k[-8:]} input={str(h["cmd"])[:100]!r} keys={h["detailkeys"]} exit={h["exit"]}')
    for s in h['snaps']: print('   t+%5.1fs status=%s outLen=%s entryTs=%s detail=%s'%s if False else '   t+%5.1fs status=%s outLen=%s entryTs=%s detail=%s'%s)
    if h['err']: print('   error:',str(h['err'])[:160])
