#!/usr/bin/env bash
set -euo pipefail

ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
BACKEND_CONTAINER="${BACKEND_CONTAINER:-backend}"
NODE_CONTAINER_UID="${NODE_CONTAINER_UID:-}"
NODE_CONTAINER_GID="${NODE_CONTAINER_GID:-}"
CRON_SCHEDULE="${CRON_SCHEDULE:-15 0 * * *}"
CRON_MARKER="ascendance-audit-seal"
OPS_LOG_DIR="${OPS_LOG_DIR:-$ASCENDANCE_DIR/backend/audit}"
CRON_LOG="${CRON_LOG:-$OPS_LOG_DIR/audit-seal-cron.log}"

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

prepare_audit_dirs() {
  local host_uid
  local host_gid
  host_uid="$(id -u)"
  host_gid="$(id -g)"

  docker run --rm \
    -v "$ASCENDANCE_DIR/backend:/host-backend" \
    alpine:3.20 \
    sh -c "mkdir -p /host-backend/audit/logs /host-backend/audit/archives && chown $host_uid:$host_gid /host-backend/audit && chmod 0750 /host-backend/audit && chown -R $NODE_CONTAINER_UID:$NODE_CONTAINER_GID /host-backend/audit/logs /host-backend/audit/archives && chmod -R u+rwX,go-rwx /host-backend/audit/logs /host-backend/audit/archives"
}

prepare_ops_logs() {
  install -d -m 0750 "$OPS_LOG_DIR"
  touch "$CRON_LOG"
  chmod 0640 "$CRON_LOG"
}

resolve_container_identity() {
  NODE_CONTAINER_UID="${NODE_CONTAINER_UID:-$(docker exec "$BACKEND_CONTAINER" id -u)}"
  NODE_CONTAINER_GID="${NODE_CONTAINER_GID:-$(docker exec "$BACKEND_CONTAINER" id -g)}"
}

verify_backend() {
  if [[ "$(docker inspect -f '{{.State.Running}}' "$BACKEND_CONTAINER" 2>/dev/null || true)" != "true" ]]; then
    echo "Backend container is not running: $BACKEND_CONTAINER" >&2
    exit 1
  fi

  if ! docker exec "$BACKEND_CONTAINER" test -f backend/dist/scripts/seal-audit-archive.js; then
    echo "Compiled audit sealer is missing from $BACKEND_CONTAINER" >&2
    echo "Deploy the updated backend image before installing the cron job." >&2
    exit 1
  fi
}

verify_timer_not_active() {
  if command -v systemctl >/dev/null 2>&1 && \
    systemctl is-active --quiet ascendance-audit-seal.timer 2>/dev/null; then
    echo "ascendance-audit-seal.timer is already active." >&2
    echo "Disable the systemd timer before installing the user cron job." >&2
    exit 1
  fi
}

install_cron() {
  local cron_command
  cron_command="cd '$ASCENDANCE_DIR' && docker exec '$BACKEND_CONTAINER' node backend/dist/scripts/seal-audit-archive.js >> '$CRON_LOG' 2>&1"

  local existing_cron
  existing_cron="$(
    (crontab -l 2>/dev/null || true) |
      sed "/^# ${CRON_MARKER}-timezone$/{N;d;}" |
      grep -v "$CRON_MARKER" || true
  )"
  {
    printf '%s\n' "$existing_cron"
    printf '# %s-timezone\n' "$CRON_MARKER"
    printf 'CRON_TZ=UTC\n'
    printf '%s %s # %s\n' "$CRON_SCHEDULE" "$cron_command" "$CRON_MARKER"
  } | sed '/^[[:space:]]*$/d' | crontab -
}

main() {
  require_command docker
  require_command crontab

  verify_backend
  verify_timer_not_active
  resolve_container_identity
  prepare_audit_dirs
  prepare_ops_logs
  install_cron

  echo "Installed user cron job:"
  crontab -l | grep "$CRON_MARKER"
  echo
  echo "Log file: $CRON_LOG"
  echo "Run manually with:"
  echo "cd '$ASCENDANCE_DIR' && docker exec '$BACKEND_CONTAINER' node backend/dist/scripts/seal-audit-archive.js"
}

main "$@"
