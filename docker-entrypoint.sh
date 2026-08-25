#!/bin/sh
set -eu

WG_CONFIG_FILE="${WG_CONFIG_FILE:-/etc/wireguard/wg0.conf}"
wg_started=0

stop() {
  if [ "$wg_started" = "1" ]; then
    echo "Stopping WireGuard…"
    wg-quick down "$WG_CONFIG_FILE" || true
  fi
}

if [ "${WG_ENABLED:-false}" = "true" ] || [ "${WG_ENABLED:-false}" = "1" ]; then
  if [ ! -r "$WG_CONFIG_FILE" ]; then
    echo "WireGuard is enabled but config is unavailable: $WG_CONFIG_FILE" >&2
    exit 1
  fi
  echo "Starting WireGuard inside this container…"
  wg-quick up "$WG_CONFIG_FILE"
  wg_started=1
fi

trap 'stop; exit 0' INT TERM

# WireGuard is started as root, then the bot drops privileges.
if [ "$(id -u)" = "0" ]; then
  setpriv --reuid=node --regid=node --init-groups "$@" &
else
  "$@" &
fi
app_pid=$!
if wait "$app_pid"; then
  status=0
else
  status=$?
fi
stop
exit "$status"
