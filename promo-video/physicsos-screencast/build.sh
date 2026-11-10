#!/bin/sh
# 《小球飞起来了》 PhysicsOS · Living Screencast — rebuild the film from this folder.
#   sh build.sh          font subset → events → score/foley/voice mix → picture → master (−14 LUFS) → .srt → poster → reading-time check
#   sh build.sh --vo     first re-synthesise the narration (MiMo mimo-v2.5-tts; MIMO_API_KEY in ../.env.local) and re-check it with Whisper
#                        (WHISPER_MODEL = a faster-whisper model name or a local folder; Chinese wants "small" or larger)
set -e
LIB=${LIB:-$HOME/lemo-opuscar}
export LIB
HERE=$(cd "$(dirname "$0")" && pwd)
[ -f "$LIB/core/render/video.mjs" ] || { echo "set LIB to the Lemo-Opuscar library folder"; exit 1; }
PY="$LIB/.venv/bin/python"
if [ "$1" = "--vo" ]; then
  node "$HERE/tools/tts_mimo.mjs"
  "$HERE/.venv-asr/bin/python" "$LIB/core/tts/asr_check.py" "$HERE/lines.json" "$HERE/voices" --lang zh --model "${WHISPER_MODEL:-small}"
fi
"$PY" "$HERE/tools/subset.py"
cd "$LIB"
node core/render/events.mjs "$HERE"
"$PY" "$HERE/sound.py"
node core/render/video.mjs "$HERE" --fps 30 --workers 6 --out "$HERE/out/video.mp4"
sh core/render/mux.sh "$HERE/out/video.mp4" "$HERE/out/mix.wav" "$HERE/physicsos-screencast.mp4" 30 0
node "$HERE/tools/subs.mjs" && "$PY" core/render/srt.py "$HERE/out/subs.json" "$HERE/physicsos-screencast.srt"
node core/render/still.mjs "$HERE" 27.6 --prefix po_ --q nosubs=1 --out "$HERE/out/stills" && cp "$HERE/out/stills/po_27.6.jpg" "$HERE/poster.jpg"
node core/render/readcheck.mjs "$HERE"
echo "built $HERE/physicsos-screencast.mp4"
