#!/bin/bash
# Gemini 3.1 Flash TTS - Voice generation for Midori agents
# Usage: tts generate --voice <voice> --text "Hello world" [--tags "[cheerfully] Hello!"] [--output /path/to/file.ogg]
# Usage: tts voices  (list available voices)
# Usage: tts agents  (list agent voice assignments)
#
# Requires: GEMINI_API_KEY environment variable
# Output: OGG Opus file (compatible with WhatsApp/Telegram voice messages)

set -e

SCRIPT_DIR="$(cd "$(dirname "$(readlink -f "$0")")" && pwd)"

if [ "$1" = "voices" ]; then
    node "$SCRIPT_DIR/tts.mjs" voices
elif [ "$1" = "agents" ]; then
    node "$SCRIPT_DIR/tts.mjs" agents
elif [ "$1" = "generate" ]; then
    shift
    node "$SCRIPT_DIR/tts.mjs" generate "$@"
else
    echo "Usage: tts <generate|voices|agents>"
    echo "  tts generate --voice Kore --text 'Hello world'"
    echo "  tts generate --agent Haru --text 'Welcome to Mythos'"
    echo "  tts voices   - list available voices"
    echo "  tts agents   - list agent voice assignments"
    exit 1
fi
