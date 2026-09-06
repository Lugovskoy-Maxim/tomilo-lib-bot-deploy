#!/usr/bin/env bash
# Run with bash; never source an application's .env as shell code.
set -Eeuo pipefail

main() {
  local repo compose=compose.yaml service=bot branch='' env_file='' project='' mode=build
  local lock='' current remote_commit local_commit
  repo="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)"
  while (($#)); do
    case "$1" in
      --repo|--compose|--service|--branch|--env-file|--project|--mode)
        if (($# < 2)) || [[ -z "$2" ]]; then echo "Missing value for $1" >&2; return 2; fi
        case "$1" in
          --repo) repo=$2 ;; --compose) compose=$2 ;; --service) service=$2 ;;
          --branch) branch=$2 ;; --env-file) env_file=$2 ;; --project) project=$2 ;; --mode) mode=$2 ;;
        esac
        shift 2 ;;
      --help|-h)
        echo 'Usage: bash update-container.sh [--repo PATH] [--compose FILE] [--service NAME]'
        echo '       [--branch NAME] [--env-file FILE] [--project NAME] [--mode build|pull]'
        echo 'Defaults: this repository, compose.yaml, bot, current branch, build.'
        return 0 ;;
      *) echo "Unknown argument: $1" >&2; return 2 ;;
    esac
  done
  [[ "$mode" == build || "$mode" == pull ]] || { echo 'Mode must be build or pull' >&2; return 2; }
  [[ "$service" =~ ^[a-zA-Z0-9][a-zA-Z0-9_.-]*$ ]] || { echo 'Invalid service name' >&2; return 2; }
  cd -- "$repo"
  repo="$(pwd -P)"
  [[ "$(git rev-parse --show-toplevel)" == "$repo" ]] || { echo 'Use the repository root' >&2; return 2; }
  current="$(git symbolic-ref --short -q HEAD)" || { echo 'Detached HEAD: choose a branch first' >&2; return 2; }
  branch=${branch:-$current}
  [[ "$branch" == "$current" ]] || { echo "Current branch is $current, not $branch; refusing to switch" >&2; return 2; }
  git check-ref-format "refs/heads/$branch" >/dev/null
  [[ -z "$(git status --porcelain --untracked-files=normal)" ]] || {
    echo 'Local changes or untracked files found. Commit or move them first; nothing was overwritten.' >&2
    git status --short
    return 1
  }
  lock="$(git rev-parse --git-path tomilo-container-update.lock)"
  mkdir -- "$lock" 2>/dev/null || { echo 'Update lock exists: another update may be running.' >&2; return 1; }
  # EXIT trap runs after main returns, so preserve the resolved path outside local scope.
  UPDATE_LOCK_PATH="$repo/$lock"
  [[ "$lock" = /* ]] && UPDATE_LOCK_PATH="$lock"
  trap 'update_exit=$?; rmdir -- "$UPDATE_LOCK_PATH" 2>/dev/null || true; exit "$update_exit"' EXIT

  local -a dc=(docker compose)
  [[ -z "$env_file" ]] || dc+=(--env-file "$env_file")
  [[ -z "$project" ]] || dc+=(--project-name "$project")
  dc+=(-f "$compose")
  docker info >/dev/null
  "${dc[@]}" up --help | grep -q -- '--wait-timeout' || {
    echo 'Docker Compose with --wait-timeout support is required.' >&2; return 1;
  }
  "${dc[@]}" config --quiet
  "${dc[@]}" config --services | grep -Fx -- "$service" >/dev/null || {
    echo "Service $service not found in $compose" >&2; return 1;
  }

  echo "Fetching origin/${branch}..."
  git fetch --no-tags origin "refs/heads/$branch"
  remote_commit="$(git rev-parse FETCH_HEAD)"
  local_commit="$(git rev-parse HEAD)"
  git merge-base --is-ancestor "$local_commit" "$remote_commit" || {
    echo 'Local commits diverge from or are ahead of origin; refusing to overwrite them.' >&2; return 1;
  }
  git merge --ff-only "$remote_commit"
  "${dc[@]}" config --quiet
  "${dc[@]}" config --services | grep -Fx -- "$service" >/dev/null || {
    echo "Updated Compose no longer contains $service" >&2; return 1;
  }
  echo "Preparing $service ($mode). Existing container stays running during preparation."
  if [[ "$mode" == build ]]; then
    "${dc[@]}" build "$service"
  else
    "${dc[@]}" pull "$service"
  fi
  echo "Recreating only ${service}..."
  if ! "${dc[@]}" up -d --no-deps --no-build --pull never --force-recreate --wait --wait-timeout 180 "$service"; then
    echo 'Container startup failed. No volumes were removed; inspect Compose logs before retrying.' >&2
    "${dc[@]}" ps "$service"
    return 1
  fi
  "${dc[@]}" ps "$service"
  echo "Updated $service: $local_commit -> $remote_commit"
  echo 'A service without a healthcheck is checked for running state only.'
}

if [[ "${BASH_SOURCE[0]}" == "$0" ]]; then
  main "$@"
fi
