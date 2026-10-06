#!/usr/bin/env bash
# Read-only Codex review of the exact committed HEAD in a scratch export.
# Usage: tools/codex-review.sh <prompt-file> [scratch-dir]
# The prompt file is passed verbatim; the script appends the exact head SHA and
# the read-only rules. Uncommitted changes are not reviewed.
set -euo pipefail

prompt_file="${1:?usage: tools/codex-review.sh <prompt-file> [scratch-dir]}"
repo="$(git rev-parse --show-toplevel)"
sha="$(git -C "$repo" rev-parse HEAD)"
scratch="${2:-${TMPDIR:-/tmp}/dayframe-codex-review}"
export_dir="$scratch/codex-${sha:0:7}"
report="$scratch/codex-${sha:0:7}-report.md"
codex_bin="${CODEX_BIN:-/Applications/ChatGPT.app/Contents/Resources/codex-cli/CodexCLI.app/Contents/MacOS/codex}"

if [[ -n "$(git -C "$repo" status --porcelain)" ]]; then
  echo "warning: uncommitted changes are not part of the review" >&2
fi

rm -rf "$export_dir"
mkdir -p "$export_dir"
git -C "$repo" archive "$sha" | tar -x -C "$export_dir"
# Reuse installed dependencies (root and workspace) so tests can run in the export.
for modules in "$repo"/node_modules "$repo"/apps/*/node_modules "$repo"/packages/*/node_modules; do
  [[ -d "$modules" ]] || continue
  target="$export_dir/${modules#"$repo"/}"
  [[ -d "$(dirname "$target")" ]] && ln -s "$modules" "$target"
done

prompt="$(cat "$prompt_file")

Exact head under review: $sha (a git archive export in this directory).
Rules: review only. Do not change code, commit, push or post anything. You may run tests and checks inside this directory.
Classify every finding as Blocker, Important or Nice-to-have with file:line and a concrete failure scenario.
End with a final line: APPROVE or REQUEST_CHANGES."

"$codex_bin" exec \
  -m gpt-6.1-sol \
  -c model_reasoning_effort=max \
  -s workspace-write \
  --skip-git-repo-check \
  -C "$export_dir" \
  -o "$report" \
  "$prompt" < /dev/null

echo "Report: $report"
