#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose-prod.yml}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
AUDIT_LOG_HOST_DIR="${AUDIT_LOG_HOST_DIR:-$ASCENDANCE_DIR/backend/audit/logs}"
AUDIT_ARCHIVE_HOST_DIR="${AUDIT_ARCHIVE_HOST_DIR:-$ASCENDANCE_DIR/backend/audit/archives}"
NODE_CONTAINER_UID="${NODE_CONTAINER_UID:-1001}"
NODE_CONTAINER_GID="${NODE_CONTAINER_GID:-1001}"
SYSTEMD_ENV_DIR="/etc/ascendance"
SYSTEMD_ENV_FILE="$SYSTEMD_ENV_DIR/audit-seal.env"

if [[ "${EUID}" -eq 0 ]]; then
  SUDO=()
else
  SUDO=(sudo)
fi

require_command() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "Missing required command: $1" >&2
    exit 1
  fi
}

write_env_file() {
  "${SUDO[@]}" install -d -m 0750 "$SYSTEMD_ENV_DIR"

  if [[ -f "$SYSTEMD_ENV_FILE" ]]; then
    echo "Keeping existing $SYSTEMD_ENV_FILE"
    return 0
  fi

  local temp_file
  temp_file="$(mktemp)"
  cat >"$temp_file" <<EOF
ASCENDANCE_DIR=$ASCENDANCE_DIR
COMPOSE_FILE=$COMPOSE_FILE
BACKEND_SERVICE=$BACKEND_SERVICE
HOST_ARCHIVE_DIR=$AUDIT_ARCHIVE_HOST_DIR

# Optional host-side upload after the container seals the archive.
# Example: gdrive:ascendance-audit
AUDIT_HOST_RCLONE_REMOTE=
AUDIT_HOST_RCLONE_BIN=rclone
AUDIT_HOST_DELETE_LOCAL_ARCHIVE=false
EOF

  "${SUDO[@]}" install -m 0640 "$temp_file" "$SYSTEMD_ENV_FILE"
  rm -f "$temp_file"
}

main() {
  require_command docker
  require_command systemctl

  "${SUDO[@]}" install -d -m 0750 "$AUDIT_LOG_HOST_DIR" "$AUDIT_ARCHIVE_HOST_DIR"
  "${SUDO[@]}" chown -R "$NODE_CONTAINER_UID:$NODE_CONTAINER_GID" \
    "$AUDIT_LOG_HOST_DIR" "$AUDIT_ARCHIVE_HOST_DIR"

  write_env_file

  local wrapper_source="$SCRIPT_DIR/seal-audit-docker.sh"
  local wrapper_target="$ASCENDANCE_DIR/scripts/audit/seal-audit-docker.sh"
  local wrapper_source_real
  local wrapper_target_real
  wrapper_source_real="$(readlink -f "$wrapper_source")"
  wrapper_target_real="$(readlink -f "$wrapper_target" 2>/dev/null || true)"

  if [[ "$wrapper_source_real" != "$wrapper_target_real" ]]; then
    "${SUDO[@]}" install -m 0755 "$wrapper_source" "$wrapper_target"
  else
    "${SUDO[@]}" chmod 0755 "$wrapper_target"
  fi
  "${SUDO[@]}" install -m 0644 \
    "$SCRIPT_DIR/systemd/ascendance-audit-seal.service" \
    /etc/systemd/system/ascendance-audit-seal.service
  "${SUDO[@]}" install -m 0644 \
    "$SCRIPT_DIR/systemd/ascendance-audit-seal.timer" \
    /etc/systemd/system/ascendance-audit-seal.timer

  "${SUDO[@]}" systemctl daemon-reload
  "${SUDO[@]}" systemctl enable --now ascendance-audit-seal.timer
  "${SUDO[@]}" systemctl list-timers ascendance-audit-seal.timer --no-pager

  echo
  echo "Installed ascendance-audit-seal.timer"
  echo "Config: $SYSTEMD_ENV_FILE"
  echo "Logs: journalctl -u ascendance-audit-seal.service --no-pager"
}

main "$@"
