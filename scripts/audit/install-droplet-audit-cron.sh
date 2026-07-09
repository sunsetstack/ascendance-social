#!/usr/bin/env bash
set -euo pipefail

ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-backend}"
NODE_CONTAINER_UID="${NODE_CONTAINER_UID:-1001}"
NODE_CONTAINER_GID="${NODE_CONTAINER_GID:-1001}"
CRON_SCHEDULE="${CRON_SCHEDULE:-15 0 * * *}"
CRON_MARKER="ascendance-audit-seal"
CRON_LOG="$ASCENDANCE_DIR/backend/audit/audit-seal-cron.log"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prepare_audit_dirs() {
  docker run --rm \
    -v "$ASCENDANCE_DIR/backend:/host-backend" \
    alpine:3.20 \
    sh -c "mkdir -p /host-backend/audit/logs /host-backend/audit/archives && chown -R $NODE_CONTAINER_UID:$NODE_CONTAINER_GID /host-backend/audit && chmod -R u+rwX,go-rwx /host-backend/audit"
}

install_cron() {
  local cron_command
  cron_command="cd $ASCENDANCE_DIR && docker exec $BACKEND_CONTAINER node backend/dist/scripts/seal-audit-archive.js >> $CRON_LOG 2>&1"

  local existing_cron
  existing_cron="$(crontab -l 2>/dev/null || true)"
  {
    printf '%s\n' "$existing_cron" | grep -v "$CRON_MARKER" || true
    printf '%s %s # %s\n' "$CRON_SCHEDULE" "$cron_command" "$CRON_MARKER"
  } | sed '/^[[:space:]]*$/d' | crontab -
}

main() {
  require_command docker
  require_command crontab

  prepare_audit_dirs
  install_cron

  echo "Installed user cron job:"
  crontab -l | grep "$CRON_MARKER"
  echo
  echo "Log file: $CRON_LOG"
  echo "Run manually with:"
  echo "cd $ASCENDANCE_DIR && docker exec $BACKEND_CONTAINER node backend/dist/scripts/seal-audit-archive.js"
}

main "$@"
