#!/bin/bash
# MODEL SIZE TRADEOFF — SIH26171.
#
# The problem statement is titled "On-device Visual Perception for LIGHT-WEIGHT Browser
# Agents", and two of the five scored metrics are resource use (20%) and end-to-end
# latency (15%). A 7B model was chosen on day one and never re-examined.
#
# WHAT THE SERVER MODEL DOES AND DOES NOT AFFECT — worth being exact, because it is easy
# to claim this study moves more of the rubric than it does:
#   - PII recall/precision and redaction precision are entirely CLIENT-side. The model
#     never sees a value and cannot affect either. Unchanged by construction.
#   - "Visual context accuracy" as score.ts measures it is extraction, also client-side.
#   - What the server model DOES decide is whether the task completes, in how many turns,
#     and how long each turn takes. That is the latency metric and the demo.
#
# So this measures the one thing that varies: does the smaller model still finish the
# task, and what does it cost. Spike E is used rather than a synthetic prompt because it
# asserts `outcome.verified` by reading the PAGE afterwards — the weakest check in this
# project used to be a spike that passed whenever result.json merely existed.
#
#   bash bench/model-tradeoff.sh [runs]        (default 3 runs per model)

set -u
ROOT="$(cd "$(dirname "$0")/.." && pwd)"; cd "$ROOT"
RUNS="${1:-3}"
PORT=8975
MODELS=(qwen2.5vl:7b qwen2.5vl:3b)
REPORT="$ROOT/bench/out/model-tradeoff.json"
mkdir -p "$ROOT/bench/out"

echo "[" > "$REPORT"; FIRST=1

for MODEL in "${MODELS[@]}"; do
  echo "=== $MODEL ==="
  # Restart the server bound to this model. An env var set on a process that is already
  # running does nothing, and a server serving the previous model while the report says
  # otherwise is the exact shape of silent mismatch this project keeps hitting.
  pkill -f "uvicorn main:app --port $PORT" 2>/dev/null; sleep 2
  ( cd server && AGENT_MODEL="$MODEL" .venv/bin/uvicorn main:app --port $PORT \
      > /tmp/tradeoff-server.log 2>&1 & )
  sleep 6

  # VERIFY the server is actually on the model we asked for, rather than assuming the
  # env var took. /health reports it, so this is checked and not hoped at.
  SERVING="$(curl -s -m 10 http://127.0.0.1:$PORT/health | python3 -c \
    'import json,sys; print(json.load(sys.stdin).get("model",""))' 2>/dev/null)"
  if [ "$SERVING" != "$MODEL" ]; then
    echo "  ABORT: asked for $MODEL, server reports '${SERVING:-nothing}'"
    continue
  fi
  echo "  server confirms model=$SERVING"

  # Resident size, read AFTER the first run rather than before it.
  #
  # ollama loads a model on its first request, so asking at server start reports nothing
  # at all — which is what happened on the first pass of this study: the 7B row carried a
  # size only because that model was already resident from earlier work, and the 3B row
  # came back blank. A measurement that silently returns empty for the case you are
  # studying is worse than no measurement.
  RSS=""

  for i in $(seq 1 "$RUNS"); do
    printf '  run %d/%d ... ' "$i" "$RUNS"
    bash spikes/e-e2e/run.sh > /tmp/tradeoff-run.log 2>&1
    LINE="$(tail -1 /tmp/tradeoff-run.log)"
    echo "$LINE"
    [ -z "$RSS" ] && RSS="$(ollama ps 2>/dev/null | awk -v m="$MODEL" '$1==m {print $3" "$4}')"
    python3 - "$MODEL" "$i" "$REPORT" "$FIRST" "$RSS" <<'PY'
import json, sys, os
model, run, report, first, rss = sys.argv[1], int(sys.argv[2]), sys.argv[3], sys.argv[4], sys.argv[5]
try:
    d = json.load(open('spikes/e-e2e/result.json'))['spikeE']
except Exception as e:
    d = {'error': str(e)}
recs = d.get('records', [])
row = {
    'model': model, 'run': run, 'rss': rss,
    'verified': bool((d.get('outcome') or {}).get('verified')),
    'turns': len(recs),
    'totalMs': sum(r['timings']['totalMs'] for r in recs),
    'networkMs': sum(r['timings']['networkMs'] for r in recs),
    'heapMb': (d.get('resources') or {}).get('heapDeltaMb'),
    'taskMs': (d.get('resources') or {}).get('taskMs'),
}
with open(report, 'a') as f:
    f.write(('' if first == '1' else ',') + json.dumps(row) + '\n')
PY
    FIRST=0
  done
done

echo "]" >> "$REPORT"

python3 - "$REPORT" <<'PY'
import json, sys, statistics as st
rows = json.load(open(sys.argv[1]))
print()
print(f"{'model':16} {'runs':>4} {'verified':>9} {'turns':>6} {'total s':>9} {'model s':>9}  resident")
print('-' * 72)
for m in dict.fromkeys(r['model'] for r in rows):
    rs = [r for r in rows if r['model'] == m]
    ok = [r for r in rs if r['verified']]
    med = lambda k: st.median([r[k] or 0 for r in rs]) / 1000
    heaps = [r['heapMb'] for r in rs if r.get('heapMb') is not None]
    print(f"{m:16} {len(rs):>4} {f'{len(ok)}/{len(rs)}':>9} "
          f"{st.median([r['turns'] for r in rs]):>6.0f} {med('taskMs'):>9.1f} "
          f"{med('networkMs'):>9.1f}  {rs[0]['rss']}"
          f"  heap {st.median(heaps) if heaps else float('nan'):.0f}MB")
print()
print("Medians. `model s` is time inside the model; `total s` is the whole task as the")
print("page experienced it, measured by the spike in the real browser. `heap` is the")
print("BROWSER heap delta, which is the client-side resource number the rubric asks for —")
print("the ollama resident size beside it is the server's, on the same machine.")
PY
