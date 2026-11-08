import json,glob,sys
for c in sys.argv[1:]:
    fs=glob.glob(f'/Users/mac/.claude/projects/-private-tmp-aa-spike-work-{c}/*.jsonl')
    for f in fs:
        for l in open(f):
            try: o=json.loads(l)
            except: continue
            m=o.get('message') or {}
            if isinstance(m.get('content'),list):
                for b in m['content']:
                    if b.get('type')=='tool_use': print(c,b['name'],json.dumps(b['input'])[:170])
