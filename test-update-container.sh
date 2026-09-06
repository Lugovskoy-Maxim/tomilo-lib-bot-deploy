#!/usr/bin/env bash
# Hermetic command mocks: never contacts Git or Docker.
set -Eeuo pipefail
cd -- "$(dirname -- "${BASH_SOURCE[0]}")"
source ./update-container.sh
scenario=${1:-success}
test_root=$(mktemp -d)
# main installs its own EXIT trap; this outer wrapper cleans the fixture directory.
(
  calls=()
  git() {
    case "$*" in
      'rev-parse --show-toplevel') pwd ;;
      'symbolic-ref --short -q HEAD') echo main ;;
      'check-ref-format refs/heads/main') return 0 ;;
      'status --porcelain --untracked-files=normal') [[ "$scenario" != dirty ]] || echo ' M local-file' ;;
      'status --short') echo ' M local-file' ;;
      'rev-parse --git-path tomilo-container-update.lock') echo "$test_root/lock" ;;
      'fetch --no-tags origin refs/heads/main') calls+=(fetch) ;;
      'rev-parse FETCH_HEAD') echo new-commit ;;
      'rev-parse HEAD') echo old-commit ;;
      'merge-base --is-ancestor old-commit new-commit') [[ "$scenario" != diverged ]] ;;
      'merge --ff-only new-commit') calls+=(merge) ;;
      *) echo "Unexpected git call: $*" >&2; return 90 ;;
    esac
  }
  docker() {
    case "$*" in
      info) return 0 ;;
      'compose -f compose.yaml up --help') echo --wait-timeout ;;
      'compose -f compose.yaml config --quiet') return 0 ;;
      'compose -f compose.yaml config --services') echo bot ;;
      'compose -f compose.yaml build bot') calls+=(build); [[ "$scenario" != build-failed ]] ;;
      'compose -f compose.yaml pull bot') calls+=(pull) ;;
      'compose -f compose.yaml up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 180 bot')
        calls+=(up); [[ "$scenario" != startup-failed ]] ;;
      'compose -f compose.yaml ps bot') return 0 ;;
      *) echo "Unexpected Docker call: $*" >&2; return 91 ;;
    esac
  }
  mode=build
  [[ "$scenario" != pull ]] || mode=pull
  main --mode "$mode"
  [[ "${calls[*]}" == "fetch merge $mode up" ]]
) &
child=$!
status=0
wait "$child" || status=$?
rmdir "$test_root"
case "$scenario" in
  success|pull) [[ "$status" == 0 ]] ;;
  dirty|diverged|build-failed|startup-failed) [[ "$status" == 1 ]] ;;
  *) exit 2 ;;
esac
echo "PASS: $scenario"
