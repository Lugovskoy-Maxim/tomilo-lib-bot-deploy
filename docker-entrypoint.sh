#!/bin/sh
set -eu

WG_CONFIG_FILE="${WG_CONFIG_FILE:-/etc/wireguard/wg0.conf}"
wg_started=0
wg_default_gateway=""
wg_default_device=""
wg_bypass_ips=""

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
  # Preserve direct routes to services that are unavailable through the VPN.
  # Resolve them before wg-quick replaces the default route.
  wg_default_gateway=$(ip route show default | awk '/default/ { print $3; exit }')
  wg_default_device=$(ip route show default | awk '/default/ { print $5; exit }')
  for wg_bypass_host in ${WG_BYPASS_HOSTS:-}; do
    wg_bypass_ips="$wg_bypass_ips $(getent ahostsv4 "$wg_bypass_host" | awk '{ print $1 }' | sort -u)"
  done

  echo "Starting WireGuard inside this container…"
  wg-quick up "$WG_CONFIG_FILE"
  wg_started=1
  if [ -n "$wg_default_gateway" ] && [ -n "$wg_default_device" ]; then
    for wg_bypass_ip in $wg_bypass_ips; do
      echo "Keeping $wg_bypass_ip outside WireGuard"
      ip route replace "$wg_bypass_ip/32" via "$wg_default_gateway" dev "$wg_default_device"
    done
  fi
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
