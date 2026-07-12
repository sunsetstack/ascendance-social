#!/bin/bash
set -euo pipefail # Exit immediately if a command exits with a non-zero status, treat unset variables as an error, and fail if any command in a pipeline fails

HOST="${MONGO_HOST:-mongo}"
ROOT_USER="${MONGO_INITDB_ROOT_USERNAME:-root}"
ROOT_PWD="${MONGO_INITDB_ROOT_PASSWORD:-secret}"
RS_NAME="${MONGO_REPLICA_SET_NAME:-rs0}"
APP_DB="${MONGO_APP_DATABASE:-}"
APP_USER="${MONGO_APP_USERNAME:-}"
APP_PWD="${MONGO_APP_PASSWORD:-}"

echo "[rs-init] Waiting for mongod on $HOST:27017 to have replication enabled"
ATTEMPTS=0
MAX_ATTEMPTS=120
ALREADY_INITIALIZED=false
while true; do
  ATTEMPTS=$((ATTEMPTS+1))
  if mongosh --quiet --host "$HOST" -u "$ROOT_USER" -p "$ROOT_PWD" --authenticationDatabase admin --eval 'db.hello().setName' 2>/dev/null | grep -q "$RS_NAME"; then
    echo "[rs-init] mongod reports setName=$RS_NAME (already initiated)"
    ALREADY_INITIALIZED=true
    break
  fi
  # Check if rs.status gives NotYetInitialized (code 94) or node is reachable
  if mongosh --quiet --host "$HOST" -u "$ROOT_USER" -p "$ROOT_PWD" --authenticationDatabase admin --eval 'try { st=rs.status(); printjson(st); } catch(e){ printjson(e); }' | grep -q 'NotYetInitialized'; then
    echo "[rs-init] Replica set not yet initialized, proceeding"; break
  fi
  if [ "$ATTEMPTS" -ge "$MAX_ATTEMPTS" ]; then
    echo "[rs-init] Timed out waiting for mongod to become reachable with replication enabled" >&2; exit 1; fi
  sleep 1
done

if [ "$ALREADY_INITIALIZED" = false ]; then
  echo "[rs-init] Running rs.initiate({_id: \"$RS_NAME\", members:[{_id:0, host: \"$HOST:27017\"}]})"
  set +e
  INIT_OUTPUT=$(mongosh --quiet --host "$HOST" -u "$ROOT_USER" -p "$ROOT_PWD" --authenticationDatabase admin --eval "try { rs.initiate({_id:'$RS_NAME',members:[{_id:0,host:'$HOST:27017'}]}) } catch(e){ printjson(e); }")
  RC=$?
  set -e

  echo "$INIT_OUTPUT"
  if [ $RC -ne 0 ]; then
    echo "[rs-init] rs.initiate returned non-zero exit code $RC" >&2
  fi
fi

sleep 3
mongosh --quiet --host "$HOST" -u "$ROOT_USER" -p "$ROOT_PWD" --authenticationDatabase admin --eval 'try { st=rs.status(); printjson({myState:st.myState, members: st.members.map(m=>({id:m._id,name:m.name,state:m.stateStr}))}) } catch(e){ printjson(e); }'

# Wait until PRIMARY state (1) to exit success so dependents can rely on full readiness
ATTEMPTS=0
while true; do
  STATE=$(mongosh --quiet --host "$HOST" -u "$ROOT_USER" -p "$ROOT_PWD" --authenticationDatabase admin --eval 'try { rs.status().myState } catch(e){ print(-1) }') || true
  if [ "$STATE" = "1" ]; then
    echo "[rs-init] PRIMARY achieved"; break; fi
  ATTEMPTS=$((ATTEMPTS+1))
  if [ $ATTEMPTS -ge 60 ]; then
    echo "[rs-init] Timed out waiting for PRIMARY state (current $STATE)" >&2; exit 1; fi
  sleep 2
  echo "[rs-init] Waiting for PRIMARY (current state=$STATE)"

done

if [ -n "$APP_DB" ] && [ -n "$APP_USER" ] && [ -n "$APP_PWD" ]; then
  echo "[rs-init] Ensuring local application user exists in $APP_DB"
  mongosh --quiet --host "$HOST" -u "$ROOT_USER" -p "$ROOT_PWD" --authenticationDatabase admin --eval '
    const appDb = db.getSiblingDB(process.env.MONGO_APP_DATABASE);
    const username = process.env.MONGO_APP_USERNAME;
    const password = process.env.MONGO_APP_PASSWORD;
    const roles = [{ role: "readWrite", db: process.env.MONGO_APP_DATABASE }];
    if (appDb.getUser(username)) {
      appDb.updateUser(username, { pwd: password, roles });
      print("[rs-init] Local application user updated");
    } else {
      appDb.createUser({ user: username, pwd: password, roles });
      print("[rs-init] Local application user created");
    }
  '
fi

echo "[rs-init] Replica set initialization completed successfully"
