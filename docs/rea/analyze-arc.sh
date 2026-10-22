#!/usr/bin/env bash
# Analyze a user-supplied Arc.app without modifying it or global agent settings.
# Reference run: Arc 1.170.0 (89123), REA 6.7.0.
# Official DMG SHA256: 5cf6d057e8944f847dac83d89b4d30d7a49c8974d02d29b35d2cf5afce9e36c1
# Do not commit extracted resources or the full proprietary semantic graph.
set -euo pipefail

if [[ $# -lt 1 || $# -gt 2 ]]; then
  printf 'Usage: %s /Applications/Arc.app [output-directory]\n' "$0" >&2
  exit 2
fi
arc_app=$(cd "$1" && pwd -P)
arc_output=${2:-./arc-analysis}
mkdir -p "$arc_output"
arc_output=$(cd "$arc_output" && pwd -P)
arc_script_dir=$(cd "$(dirname "$0")" && pwd -P)

if [[ ! -f "$arc_app/Contents/MacOS/Arc" ]]; then
  printf 'The supplied directory does not contain the Arc executable.\n' >&2
  exit 2
fi

npm install --prefix "$arc_output/rea-tooling" --ignore-scripts --no-audit --no-fund rea-agents@6.7.0
rea_cli="$arc_output/rea-tooling/node_modules/.bin/rea"
"$rea_cli" --version > "$arc_output/rea-version.txt"
"$rea_cli" inspect-artifact "$arc_app/Contents/MacOS/Arc" --format json --full-output > "$arc_output/native-artifact.evidence.json"

arc_resources=(
  'ARC_BoostsEditor.bundle/Contents/Resources/SelectorPicker.js'
  'ARC_EaselUI.bundle/Contents/Resources/DisableInlineLinks.js'
  'ARC_CommandBar.bundle/Contents/Resources/command_bar_behavior.json'
  'ARC_WebContentBehaviorConfigurationClient.bundle/Contents/Resources/web_content_behavior.json'
)
for relative in "${arc_resources[@]}"; do
  source_file="$arc_app/Contents/Resources/$relative"
  if [[ ! -f "$source_file" ]]; then
    printf 'Selected resource missing in this Arc version: %s\n' "$relative" >&2
    exit 2
  fi
  mkdir -p "$arc_output/selected-resources/$(dirname "$relative")"
  cp "$source_file" "$arc_output/selected-resources/$relative"
done

"$rea_cli" analyze-javascript-application "$arc_output/selected-resources" \
  --format json --full-output --analysis-timeout-ms 30000 \
  > "$arc_output/javascript.evidence.json"

python3 "$arc_script_dir/inspect_macho_metadata.py" "$arc_app/Contents/MacOS/Arc" \
  > "$arc_output/native-metadata-python.json"

if [[ $(uname -s) == Darwin ]]; then
  "$rea_cli" inspect-macho "$arc_app" --format json --full-output > "$arc_output/macho.evidence.json"
  "$rea_cli" inspect-plist "$arc_app" --format json --full-output > "$arc_output/plist.evidence.json"
fi

printf 'Analysis saved to %s\n' "$arc_output"
printf 'The output includes proprietary source-derived material; keep it outside the open-source repository.\n'
