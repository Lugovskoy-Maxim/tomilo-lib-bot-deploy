#!/bin/sh
set -eu

WG_CONFIG_FILE="${WG_CONFIG_FILE:-/etc/wireguard/wg0.conf}"
wg_started=0
wg_default_gateway=""
wg_default_device=""
wg_bypass_ips=""

# MAX использует Russian Trusted Root CA и выпускающий CA Минцифры. Загружаем
# официальный комплект и проверяем отпечатки до включения доверия Node.js.
if [ "${MAX_ENABLED:-false}" = "true" ] || [ "${MAX_ENABLED:-false}" = "1" ]; then
  ca_file="${MAX_CA_CERT_PATH:-/data/mincifry.pem}"
  if [ ! -s "$ca_file" ]; then
    mkdir -p "$(dirname "$ca_file")"
    ca_tmp="${ca_file}.tmp"
    : > "$ca_tmp"
    download_and_verify_ca() {
      ca_url="$1"
      expected_fingerprint="$2"
      ca_part="${ca_file}.part"
      curl --fail --location --silent --show-error "$ca_url" -o "$ca_part"
      actual_fingerprint=$(openssl x509 -in "$ca_part" -noout -fingerprint -sha256 \
        | sed 's/.*=//; s/://g' | tr '[:lower:]' '[:upper:]')
      if [ "$actual_fingerprint" != "$expected_fingerprint" ]; then
        rm -f "$ca_part" "$ca_tmp"
        echo "Minцифры certificate fingerprint mismatch; refusing to install it." >&2
        exit 1
      fi
      cat "$ca_part" >> "$ca_tmp"
      printf '\n' >> "$ca_tmp"
      rm -f "$ca_part"
    }
    echo "Installing the official Russian Trusted CA bundle for MAX…"
    download_and_verify_ca \
      https://gu-st.ru/content/lending/russian_trusted_root_ca_pem.crt \
      D26D2D0231B7C39F92CC738512BA54103519E4405D68B5BD703E9788CA8ECF31
    download_and_verify_ca \
      https://gu-st.ru/content/lending/russian_trusted_sub_ca_pem.crt \
      BBBDE2103E790B999EC62BD03CF625A5A2E7C316E10AFE6A490EEDEAD8B3FD9B
    download_and_verify_ca \
      https://gu-st.ru/content/lending/russian_trusted_sub_ca_2024_pem.crt \
      2155785036C900DBB5F1BB2A1569C80C55595BD6BF94867A29BBDDBC7D88A3F2
    mv "$ca_tmp" "$ca_file"
    chmod 0644 "$ca_file"
  fi
  export NODE_EXTRA_CA_CERTS="$ca_file"
fi

# Named volume создаётся Docker от root. Бот работает от node, поэтому выдаём
# ему доступ до запуска приложения; это сохраняет state и защиту от дублей.
if [ "$(id -u)" = "0" ] && [ -d /data ]; then
  chown -R node:node /data
fi

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
  # API сайта идёт напрямую. S3 с обложками, напротив, доступен на этом VPS
  # только через WireGuard, поэтому его IP закрепляем до смены DNS, но маршрут
  # через VPN не исключаем.
  for wg_bypass_host in \
    tomilo-lib.ru cdn.tomilo-lib.ru \
    platform-api2.max.ru \
    ${WG_BYPASS_HOSTS:-}; do
    case "$wg_bypass_host" in
      s3.regru.cloud|tomilolib.s3.regru.cloud)
        # Не даём пользовательскому старому списку случайно вывести S3 из VPN.
        continue
        ;;
    esac
    wg_bypass_ips="$wg_bypass_ips $(getent ahostsv4 "$wg_bypass_host" | awk '{ print $1 }' | sort -u)"
  done

  for wg_s3_host in s3.regru.cloud tomilolib.s3.regru.cloud; do
    for wg_s3_ip in $(getent ahostsv4 "$wg_s3_host" | awk '{ print $1 }' | sort -u); do
      # TLS продолжает видеть исходное имя хоста, а Node не делает DNS-запрос
      # через VPN, где для S3 на данном сервере приходит EAI_AGAIN.
      echo "$wg_s3_ip $wg_s3_host" >> /etc/hosts
      echo "Routing $wg_s3_host through WireGuard ($wg_s3_ip)"
    done
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
