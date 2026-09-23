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
  : "${AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64:?AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64 is required}"
  cd "$ASCENDANCE_DIR"

  local container_ids
  local -a backend_containers
  container_ids="$(docker_compose ps -q "$BACKEND_SERVICE")"
  mapfile -t backend_containers < <(printf '%s\n' "$container_ids" | sed '/^[[:space:]]*$/d')
  if [[ "${#backend_containers[@]}" -ne 1 ]]; then
    echo "Expected exactly one running Compose backend container for $BACKEND_SERVICE" >&2
    return 1
  fi

  local backend_container="${backend_containers[0]}"
  if [[ "$(docker inspect -f '{{.State.Running}}' "$backend_container")" != "true" ]]; then
    echo "Compose backend container is not running: $backend_container" >&2
    return 1
  fi

  local backend_image_id
  backend_image_id="$(docker inspect -f '{{.Image}}' "$backend_container")"
  if [[ ! "$backend_image_id" =~ ^sha256:[0-9a-f]{64}$ ]]; then
    echo "Compose backend image ID is unavailable or not immutable: $backend_image_id" >&2
    return 1
  fi

  local local_image_id
  if ! local_image_id="$(docker image inspect -f '{{.Id}}' "$backend_image_id")"; then
    echo "Running Compose backend image is not present locally: $backend_image_id" >&2
    return 1
  fi
  if [[ "$local_image_id" != "$backend_image_id" ]]; then
    echo "Running Compose backend image ID could not be verified: $backend_image_id" >&2
    return 1
  fi
  export BACKEND_IMAGE="$backend_image_id"
  export AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64

  if docker_compose run --rm --no-deps \
    --pull never \
    -T \
    -e AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64 \
    "$BACKEND_SERVICE" \
    node backend/dist/scripts/seal-audit-archive.js "$@"
  then
    unset BACKEND_IMAGE
    unset AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64
  else
    local exit_code=$?
    unset BACKEND_IMAGE
    unset AUDIT_ARCHIVE_ENCRYPTION_KEY_BASE64
    return "$exit_code"
  fi

  copy_with_host_rclone "$date_value"
}

main "$@"
