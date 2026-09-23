#!/usr/bin/env bash
set -euo pipefail

ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose-prod.yml}"
BACKEND_SERVICE="${BACKEND_SERVICE:-backend}"
HOST_FORENSIC_ARCHIVE_DIR="${HOST_FORENSIC_ARCHIVE_DIR:-$ASCENDANCE_DIR/backend/forensic/archives}"
FORENSIC_HOST_RCLONE_BIN="${FORENSIC_HOST_RCLONE_BIN:-rclone}"

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

remote_sha256() {
  local remote_path="$1"
  "$FORENSIC_HOST_RCLONE_BIN" cat "$remote_path" | sha256sum | awk '{print $1}'
}

copy_file_immutably_and_verify() {
  local local_path="$1"
  local remote_path="$2"
  local expected_hash="$3"
  local description="$4"

  local existing_remote_hash=""
  if existing_remote_hash="$(remote_sha256 "$remote_path" 2>/dev/null)"; then
    if [[ "$existing_remote_hash" != "$expected_hash" ]]; then
      echo "Existing remote ${description} checksum conflict: ${remote_path}" >&2
      return 1
    fi
    echo "Remote ${description} already verified: ${remote_path}"
    return 0
  fi

  local staging_path="${remote_path}.uploading-${expected_hash}"
  "$FORENSIC_HOST_RCLONE_BIN" copyto --ignore-times "$local_path" "$staging_path"

  local staging_hash
  staging_hash="$(remote_sha256 "$staging_path")"
  if [[ "$staging_hash" != "$expected_hash" ]]; then
    echo "Remote ${description} staging verification failed: ${staging_path}" >&2
    return 1
  fi

  if ! "$FORENSIC_HOST_RCLONE_BIN" copyto --immutable "$staging_path" "$remote_path"; then
    existing_remote_hash="$(remote_sha256 "$remote_path" 2>/dev/null || true)"
    if [[ "$existing_remote_hash" != "$expected_hash" ]]; then
      echo "Remote ${description} immutable promotion failed: ${remote_path}" >&2
      return 1
    fi
  fi

  local copied_remote_hash
  copied_remote_hash="$(remote_sha256 "$remote_path")"
  if [[ "$copied_remote_hash" != "$expected_hash" ]]; then
    echo "Remote ${description} verification failed: ${remote_path}" >&2
    return 1
  fi

  "$FORENSIC_HOST_RCLONE_BIN" deletefile "$staging_path" >/dev/null 2>&1 || true
  echo "Copied and verified ${description}: ${remote_path}"
}

copy_and_verify_remote() {
  local date_value="$1"
  local remote="${FORENSIC_HOST_RCLONE_REMOTE:?FORENSIC_HOST_RCLONE_REMOTE is required}"
  local archive_path="$HOST_FORENSIC_ARCHIVE_DIR/forensic-${date_value}.v1.json.gz.enc"
  local checksum_path="${archive_path}.sha256"

  if [[ ! -f "$archive_path" || ! -f "$checksum_path" ]]; then
    echo "Missing local forensic archive or checksum for ${date_value}" >&2
    return 1
  fi

  local expected_hash
  expected_hash="$(awk 'NR == 1 { print $1 }' "$checksum_path")"
  printf '%s  %s\n' "$expected_hash" "$archive_path" | sha256sum -c - >/dev/null

  local year="${date_value:0:4}"
  local month="${date_value:5:2}"
  local file_name
  file_name="$(basename "$archive_path")"
  local remote_path="${remote%/}/${year}/${month}/${file_name}"
  local remote_checksum_path="${remote_path}.sha256"
  local checksum_hash
  checksum_hash="$(sha256sum "$checksum_path" | awk '{print $1}')"

  copy_file_immutably_and_verify \
    "$archive_path" "$remote_path" "$expected_hash" "forensic archive"
  copy_file_immutably_and_verify \
    "$checksum_path" "$remote_checksum_path" "$checksum_hash" \
    "forensic archive checksum"
}

main() {
  local date_value
  date_value="$(resolve_date "$@")"
  local encryption_key="${FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64:?FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64 is required}"

  cd "$ASCENDANCE_DIR"
  docker_compose exec -T \
    -e FORENSIC_ARCHIVE_ENCRYPTION_KEY_BASE64="$encryption_key" \
    -e FORENSIC_SEALER_MONGODB_URI="${FORENSIC_SEALER_MONGODB_URI:-}" \
    "$BACKEND_SERVICE" \
    node backend/dist/scripts/seal-forensic-archive.js --date="$date_value"

  copy_and_verify_remote "$date_value"
}

main "$@"
