#!/bin/sh
# Some VPS kernels expose net.ipv4.conf.all.src_valid_mark as a host-only
# sysctl. wg-quick sets it for full-tunnel routing, but Docker is forbidden to
# change it there. Docker namespaces normally have reverse-path filtering off,
# so let wg-quick continue while delegating every other sysctl call unchanged.
if [ "$#" -eq 2 ] \
  && [ "$1" = "-q" ] \
  && [ "$2" = "net.ipv4.conf.all.src_valid_mark=1" ]; then
  exit 0
fi
exec /usr/sbin/sysctl "$@"
