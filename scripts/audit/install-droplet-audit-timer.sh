#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose-prod.yml}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
AUDIT_LOG_HOST_DIR="${AUDIT_LOG_HOST_DIR:-$ASCENDANCE_DIR/backend/audit/logs}"
AUDIT_ARCHIVE_HOST_DIR="${AUDIT_ARCHIVE_HOST_DIR:-$ASCENDANCE_DIR/backend/audit/archives}"
NODE_CONTAINER_UID="${NODE_CONTAINER_UID:-}"
NODE_CONTAINER_GID="${NODE_CONTAINER_GID:-}"
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

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

resolve_container_identity() {
  NODE_CONTAINER_UID="${NODE_CONTAINER_UID:-$(docker_compose exec -T "$BACKEND_SERVICE" id -u)}"
  NODE_CONTAINER_GID="${NODE_CONTAINER_GID:-$(docker_compose exec -T "$BACKEND_SERVICE" id -g)}"
}

verify_backend() {
  if ! docker_compose exec -T "$BACKEND_SERVICE" test -f backend/dist/scripts/seal-audit-archive.js; then
    echo "Compiled audit sealer is missing from service: $BACKEND_SERVICE" >&2
    echo "Deploy the updated backend image before installing the timer." >&2
    exit 1
  fi
}

verify_cron_not_installed() {
  if ! command -v crontab >/dev/null 2>&1; then
    return 0
  fi

  local cron_user
  local cron_contents
  cron_user="${SUDO_USER:-$(id -un)}"
  if [[ "$cron_user" = "$(id -un)" ]]; then
    cron_contents="$(crontab -l 2>/dev/null || true)"
  else
    cron_contents="$("${SUDO[@]}" crontab -u "$cron_user" -l 2>/dev/null || true)"
  fi

  if grep -q "ascendance-audit-seal" <<<"$cron_contents"; then
    echo "The ascendance-audit-seal user cron is already installed for $cron_user." >&2
    echo "Remove that cron entry before installing the systemd timer." >&2
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

  cd "$ASCENDANCE_DIR"
  verify_backend
  verify_cron_not_installed
  resolve_container_identity

  "${SUDO[@]}" install -d -m 0750 "$AUDIT_LOG_HOST_DIR" "$AUDIT_ARCHIVE_HOST_DIR"
  "${SUDO[@]}" chown -R "$NODE_CONTAINER_UID:$NODE_CONTAINER_GID" \
    "$AUDIT_LOG_HOST_DIR" "$AUDIT_ARCHIVE_HOST_DIR"

  write_env_file

  local wrapper_source="$SCRIPT_DIR/seal-audit-docker.sh"
  "${SUDO[@]}" install -m 0755 \
    "$wrapper_source" \
    /usr/local/sbin/ascendance-audit-seal
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
