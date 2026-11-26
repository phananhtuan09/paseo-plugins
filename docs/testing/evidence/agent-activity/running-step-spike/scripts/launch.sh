#!/bin/bash
for x in "C1a 50" "C1b 160" "C2 45" "C3 45" "C4 40" "C5 45" "C6 175" "C7 50" "C9 100" "C11 100" "C13 50"; do
  read -r c s <<< "$x"; /tmp/aa-spike/run.sh "$c" "$s" 2>&1 | grep -v "Tip\|Created"
done
