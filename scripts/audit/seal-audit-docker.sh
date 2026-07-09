#!/usr/bin/env bash
set -euo pipefail

ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose-prod.yml}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
HOST_ARCHIVE_DIR="${HOST_ARCHIVE_DIR:-$ASCENDANCE_DIR/backend/audit/archives}"
AUDIT_HOST_RCLONE_BIN="${AUDIT_HOST_RCLONE_BIN:-rclone}"
AUDIT_HOST_DELETE_LOCAL_ARCHIVE="${AUDIT_HOST_DELETE_LOCAL_ARCHIVE:-false}"

resolve_date() {
  local arg
  for arg in "$@"; do
    case "$arg" in
      --date=*)
        printf '%s\n' "${arg#--date=}"
        return 0
        ;;
      [0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9])
        printf '%s\n' "$arg"
        return 0
        ;;
    esac
  done

  date -u -d "yesterday" +%F
}

docker_compose() {
  if docker compose version >/dev/null 2>&1; then
    docker compose -f "$COMPOSE_FILE" "$@"
  else
    docker-compose -f "$COMPOSE_FILE" "$@"
  fi
}

copy_with_host_rclone() {
  local date_value="$1"
  local remote="${AUDIT_HOST_RCLONE_REMOTE:-}"
  if [[ -z "$remote" ]]; then
    return 0
  fi

  local archive_path
  archive_path="$(find "$HOST_ARCHIVE_DIR" -maxdepth 1 -type f -name "audit-${date_value}.json.gz*" | sort | tail -n 1 || true)"
  if [[ -z "$archive_path" ]]; then
    echo "No sealed archive found for ${date_value} in ${HOST_ARCHIVE_DIR}; skipping host rclone copy"
    return 0
  fi

  local year="${date_value:0:4}"
  local month="${date_value:5:2}"
  local file_name
  file_name="$(basename "$archive_path")"
  local remote_path="${remote%/}/${year}/${month}/${file_name}"

  "$AUDIT_HOST_RCLONE_BIN" copyto "$archive_path" "$remote_path"
  echo "Copied ${archive_path} to ${remote_path}"

  if [[ "$AUDIT_HOST_DELETE_LOCAL_ARCHIVE" == "true" ]]; then
    rm -f "$archive_path"
    echo "Deleted local sealed archive after host rclone copy: ${archive_path}"
  fi
}

main() {
  local date_value
  date_value="$(resolve_date "$@")"

  cd "$ASCENDANCE_DIR"
  docker_compose exec -T "$BACKEND_SERVICE" \
    node backend/dist/scripts/seal-audit-archive.js "$@"

  copy_with_host_rclone "$date_value"
}

main "$@"
