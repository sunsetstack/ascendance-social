#!/usr/bin/env bash
set -euo pipefail

REMOTE="${1:?Usage: pull-audit-archives.sh user@host [remote-dir] [local-dir]}"
REMOTE_DIR="${2:-/opt/ascendance-social/backend/audit/archives}"
LOCAL_DIR="${3:-$HOME/AscendanceAuditArchives}"
DELETE_REMOTE_AFTER_PULL="${DELETE_REMOTE_AFTER_PULL:-false}"

mkdir -p "$LOCAL_DIR"

remote_list_command="find '$REMOTE_DIR' -type f \( -name 'audit-*.json.gz' -o -name 'audit-*.json.gz.enc' \) -exec sha256sum {} \;"

while read -r expected_hash remote_path; do
  [[ -n "${expected_hash:-}" && -n "${remote_path:-}" ]] || continue

  relative_path="${remote_path#"$REMOTE_DIR"/}"
  local_path="$LOCAL_DIR/$relative_path"
  mkdir -p "$(dirname "$local_path")"

  if [[ -f "$local_path" ]] && printf '%s  %s\n' "$expected_hash" "$local_path" | sha256sum -c - >/dev/null 2>&1; then
    echo "Already verified: $relative_path"
  else
    scp "$REMOTE:$remote_path" "$local_path"
    printf '%s  %s\n' "$expected_hash" "$local_path" | sha256sum -c -
    echo "Verified: $relative_path"
  fi

  if [[ "$DELETE_REMOTE_AFTER_PULL" == "true" ]]; then
    ssh "$REMOTE" "rm -f '$remote_path'"
    echo "Deleted remote archive after verified pull: $remote_path"
  fi
done < <(ssh "$REMOTE" "$remote_list_command")
