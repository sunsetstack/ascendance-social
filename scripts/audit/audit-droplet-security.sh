#!/usr/bin/env bash
set -u

ASCENDANCE_DIR="${ASCENDANCE_DIR:-/opt/ascendance-social}"
COMPOSE_FILE="${COMPOSE_FILE:-docker-compose-prod.yml}"

section() {
  printf '\n## %s\n\n' "$1"
}

run() {
  printf '$ %s\n' "$*"
  "$@" 2>&1 || true
  printf '\n'
}

run_shell() {
  printf '$ %s\n' "$*"
  bash -lc "$*" 2>&1 || true
  printf '\n'
}

section "Host"
run hostnamectl
run uptime
run_shell "cat /etc/os-release"
run uname -a
run whoami

section "Package Updates"
run_shell "apt-get -s upgrade 2>/dev/null | awk '/^Inst / {print}' | head -100"
run_shell "dpkg -l unattended-upgrades apt-listchanges 2>/dev/null | awk 'NR==1 || /^ii/ {print}'"
run systemctl status unattended-upgrades --no-pager

section "Users And Privilege"
run_shell "awk -F: '\$3 == 0 {print}' /etc/passwd"
run getent group sudo
run getent group docker
run_shell "find /home -maxdepth 2 -name authorized_keys -type f -printf '%p %m %u:%g\n' 2>/dev/null"

section "SSH"
run_shell "sshd -T 2>/dev/null | grep -Ei '^(permitrootlogin|passwordauthentication|pubkeyauthentication|kbdinteractiveauthentication|permitemptypasswords|maxauthtries|x11forwarding|allowusers|allowgroups|clientalive)'"
run_shell "grep -RInE '^(PermitRootLogin|PasswordAuthentication|PubkeyAuthentication|KbdInteractiveAuthentication|PermitEmptyPasswords|MaxAuthTries|X11Forwarding|AllowUsers|AllowGroups)' /etc/ssh/sshd_config /etc/ssh/sshd_config.d 2>/dev/null"

section "Firewall And Listening Ports"
run ufw status verbose
run_shell "ss -tulpn | sed -E 's/users:\\(\\([^)]*\\)\\)/users:(redacted)/g'"
run_shell "iptables -S 2>/dev/null | head -120"

section "Docker"
run docker ps --format "table {{.Names}}\t{{.Image}}\t{{.Status}}\t{{.Ports}}"
run docker network ls
run docker volume ls
if [[ -d "$ASCENDANCE_DIR" ]]; then
  run_shell "cd '$ASCENDANCE_DIR' && (docker compose -f '$COMPOSE_FILE' ps || docker-compose -f '$COMPOSE_FILE' ps)"
fi

section "Ascendance Files"
run_shell "ls -ld '$ASCENDANCE_DIR' '$ASCENDANCE_DIR/backend' '$ASCENDANCE_DIR/backend/audit' '$ASCENDANCE_DIR/backend/audit/logs' '$ASCENDANCE_DIR/backend/audit/archives' 2>/dev/null"
run_shell "du -sh '$ASCENDANCE_DIR/backend/audit' '$ASCENDANCE_DIR/backend/uploads' 2>/dev/null"
run_shell "find '$ASCENDANCE_DIR/backend/audit' -maxdepth 3 -type f -printf '%TY-%Tm-%Td %TH:%TM %s %p\n' 2>/dev/null | sort | tail -40"

section "Systemd"
run systemctl --failed --no-pager
run systemctl list-timers ascendance-audit-seal.timer --no-pager
run systemctl status ascendance-audit-seal.timer --no-pager
run systemctl status ascendance-audit-seal.service --no-pager

section "Recent Warnings"
run journalctl -p warning..alert -n 80 --no-pager

section "Quick Interpretation"
cat <<'EOF'
Review these first:
- SSH: PermitRootLogin should usually be "no" or "prohibit-password"; PasswordAuthentication should usually be "no".
- Firewall: only 22, 80, and 443 should be publicly reachable unless you intentionally expose more.
- Prometheus/Grafana: if exposed through Caddy, protect them with Cloudflare Access, basic auth, or restrict by IP.
- Docker group: any user in docker is effectively root-equivalent.
- System updates: unattended-upgrades should be installed and running.
- Audit timer: ascendance-audit-seal.timer should show a future NEXT run.
- Audit directories: backend/audit should not be world-readable if archives are unencrypted.
EOF
