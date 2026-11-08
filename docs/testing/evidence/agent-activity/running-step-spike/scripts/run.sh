#!/bin/bash
# usage: run.sh <case> <probeSeconds> [mode]
C="$1"; S="$2"; M="${3:-bypassPermissions}"
cd "/tmp/aa-spike/work/$C"
ID=$(paseo run --home /tmp/paseo-e2e-home -q --no-wait --title "spike-$C" --provider claude --model claude-haiku-5-5 --mode $M --cwd "/tmp/aa-spike/work/$C" "$(cat prompt.txt)")
echo "$C $ID $(date +%T)" >> /tmp/aa-spike/ids.txt
nohup env ELECTRON_RUN_AS_NODE=1 /Applications/Paseo.app/Contents/MacOS/Paseo /tmp/aa-spike/probe.mjs "$ID" "/tmp/aa-spike/raw/$C.jsonl" "$S" 500 >/dev/null 2>&1 &
