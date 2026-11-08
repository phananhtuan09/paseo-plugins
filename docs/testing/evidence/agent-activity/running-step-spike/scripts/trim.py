import json,glob,os,sys
out=sys.argv[1]
for f in sorted(glob.glob('/tmp/aa-spike/raw/*.jsonl')):
    name=os.path.basename(f)
    if name=='test.jsonl': continue
    with open(f'{out}/raw/{name}','w') as w:
        for l in open(f):
            o=json.loads(l)
            if o['kind']=='refetch':
                o['entries']=[{'timestamp':e['timestamp'],'turnId':e.get('turnId'),'item':e['item']} for e in o['entries'] if e['item']['type']=='tool_call']
            elif o['kind']=='live':
                p=(o['message'].get('payload') or {}); ev=p.get('event') or {}
                t=ev.get('type')
                slim={'type':t}
                if t=='timeline': slim['item']=ev.get('item') if (ev.get('item') or {}).get('type')=='tool_call' else {'type':(ev.get('item') or {}).get('type')}
                elif t=='permission_requested':
                    r=ev.get('request',{}); slim['request']={'id':r.get('id'),'name':r.get('name'),'detail':r.get('detail'),'metadata':r.get('metadata')}
                elif t=='permission_resolved': slim.update({'requestId':ev.get('requestId'),'resolution':ev.get('resolution')})
                o={'t':o['t'],'kind':'live','event':slim}
            w.write(json.dumps(o,separators=(',',':'))+'\n')
