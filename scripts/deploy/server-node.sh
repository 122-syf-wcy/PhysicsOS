#!/usr/bin/env bash
# Run deployment Node programs in a cached Docker tool image. No host Node is needed.
set -euo pipefail
umask 077

fail() { printf 'server-node: %s\n' "$*" >&2; exit 1; }
command -v docker >/dev/null || fail 'Docker is required on the deployment server'
command -v python3 >/dev/null || fail 'Python 3 is required on the deployment server'
[[ $(uname -s) == Linux ]] || fail 'Run this entry point on the Linux deployment server'
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)
project_dir=${PHYSICSOS_DIR:-$(cd "$script_dir/../.." && pwd -P)}
[[ $project_dir =~ ^/[A-Za-z0-9_./\ -]+$ && $project_dir != / ]] || fail 'Invalid project path'
project_dir=$(cd "$project_dir" && pwd -P)
[[ -e "$project_dir/.git" ]] || fail 'Project Git metadata is required'
mode=${1:-}
if [[ $mode == --check || $mode == --prepare ]]; then shift; fi
[[ $mode == --check || $mode == --prepare || $# -gt 0 ]] || fail 'Specify a Node program, --prepare or --check'

base_image=$(docker inspect physicsos-app-1 --format '{{.Image}}')
[[ $base_image =~ ^sha256:[0-9a-f]{64}$ ]] || fail 'Cannot identify the current production image'
node_identity=$(docker run --rm --network none --read-only --entrypoint node "$base_image" -e 'process.stdout.write(process.versions.node+"-"+process.platform+"-"+process.arch)')
[[ $node_identity =~ ^[0-9]+\.[0-9]+\.[0-9]+-linux-[a-z0-9]+$ ]] || fail 'Unsupported Node tool identity'
dockerfile_hash=$(sha256sum "$script_dir/release-tools.Dockerfile"); dockerfile_hash=${dockerfile_hash%% *}
tools_key=$(printf '%s\n%s' "$node_identity" "$dockerfile_hash" | sha256sum); tools_key=${tools_key%% *}
tools_tag="physicsos:release-tools-${tools_key:0:20}"

if ! docker image inspect "$tools_tag" >/dev/null 2>&1; then
  [[ $mode != --check ]] || fail 'Deployment tools are not prepared; run server-node.sh --prepare'
  available_kb=$(df -Pk "$project_dir" | awk 'NR==2 {print $4}')
  (( available_kb >= 196608 )) || fail 'Need 192 MiB free to prepare deployment tools'
  install -d -m 700 "$project_dir/.physicsos-release"
  base_tag="physicsos:release-tools-base-${base_image:7:16}"
  docker tag "$base_image" "$base_tag"
  [[ $(docker image inspect "$base_tag" --format '{{.Id}}') == "$base_image" ]] || fail 'Tool base tag changed'
  context=$(mktemp -d "$project_dir/.physicsos-release/tools-context-XXXXXX")
  trap 'rm -rf -- "$context"' EXIT
  printf 'server-node: preparing cached deployment tools\n' >&2
  docker build --pull=false --build-arg "BASE_IMAGE=$base_tag" \
    --label physicsos.role=release-tools --label "physicsos.tools.identity=$node_identity" \
    --label "physicsos.tools.source=$dockerfile_hash" --tag "$tools_tag" \
    --file "$script_dir/release-tools.Dockerfile" "$context" \
    >"$project_dir/.physicsos-release/tools-build.log" 2>&1 || fail 'Tool image build failed; private build log retained'
  rm -rf -- "$context"; trap - EXIT
fi
tools_image=$(docker image inspect "$tools_tag" --format '{{.Id}}')
[[ $(docker image inspect "$tools_image" --format '{{index .Config.Labels "physicsos.role"}}') == release-tools ]] || fail 'Unexpected tools image owner'
[[ $(docker image inspect "$tools_image" --format '{{index .Config.Labels "physicsos.tools.identity"}}') == "$node_identity" ]] || fail 'Tools Node identity changed'
[[ $(docker image inspect "$tools_image" --format '{{index .Config.Labels "physicsos.tools.source"}}') == "$dockerfile_hash" ]] || fail 'Tools recipe changed'
if [[ $mode == --prepare ]]; then
  printf '{"toolsImage":"%s","nodeIdentity":"%s"}\n' "$tools_image" "$node_identity"
  exit 0
fi

docker_binary=$(command -v docker)
mounts=(--mount "type=bind,src=$project_dir,dst=$project_dir" \
        --mount "type=bind,src=$docker_binary,dst=/usr/local/bin/docker,readonly" \
        --mount type=bind,src=/var/run/docker.sock,dst=/var/run/docker.sock)
if [[ $script_dir != "$project_dir/"* ]]; then
  mounts+=(--mount "type=bind,src=$script_dir,dst=$script_dir,readonly")
fi
# Existing secret directories are read-only; configured offsite backup roots
# may be writable. Never mount the Docker data root through an ancestor bind.
docker_root=$(docker info --format '{{.DockerRootDir}}')
declare -A additional_roots=()
add_mount() {
  local directory=$1 access=$2
  [[ $directory =~ ^/[A-Za-z0-9_./\ -]+$ && $directory != / ]] || fail 'Invalid additional file root'
  directory=$(python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$directory")
  [[ $directory != / ]] || fail 'Additional file root resolves to the filesystem root'
  [[ $directory != "$project_dir" && $directory != "$project_dir/"* ]] || return 0
  if [[ $access == writable ]]; then
    [[ $docker_root != "$directory" && $docker_root != "$directory/"* ]] || fail 'Backup root would expose production Docker data writable'
    [[ $mode != --check || -d $directory ]] || fail 'Configured backup root is missing'
    [[ -d $directory ]] || install -d -m 700 "$directory"
    additional_roots["$directory"]=writable
  else
    [[ -d $directory ]] || fail 'Configured secret directory is missing'
    [[ ${additional_roots[$directory]:-} == writable ]] || additional_roots["$directory"]=readonly
  fi
}
mapfile -t secret_roots < <(docker inspect physicsos-app-1 --format '{{json .Mounts}}' | python3 -c 'import json,os,sys; print("\n".join(sorted({os.path.dirname(m["Source"]) for m in json.load(sys.stdin) if m.get("Type")=="bind" and m.get("Destination","").startswith("/run/secrets/")})))')
for directory in "${secret_roots[@]}"; do [[ -z $directory ]] || add_mount "$directory" readonly; done
if [[ -n ${PHYSICSOS_BACKUP_KEY_FILE:-} ]]; then add_mount "$(dirname "$PHYSICSOS_BACKUP_KEY_FILE")" readonly; fi
for name in PHYSICSOS_BACKUP_DIR PHYSICSOS_FULL_BACKUP_DIR PHYSICSOS_BACKUP_OFFSITE_DIR; do
  [[ -z ${!name:-} ]] || add_mount "${!name}" writable
done
for directory in "${!additional_roots[@]}"; do
  if [[ ${additional_roots[$directory]} == readonly ]]; then
    mounts+=(--mount "type=bind,src=$directory,dst=$directory,readonly")
  else
    mounts+=(--mount "type=bind,src=$directory,dst=$directory")
  fi
done
mapfile -t plugins < <(docker info --format '{{json .ClientInfo.Plugins}}' | python3 -c 'import json,sys; [print(p["Name"]+"\t"+p["Path"]) for p in (json.load(sys.stdin) or []) if p.get("Name") in ("compose","buildx")]')
compose_found=false
for item in "${plugins[@]}"; do
  name=${item%%$'\t'*}; path=${item#*$'\t'}
  [[ $path =~ ^/[A-Za-z0-9_./\ -]+$ && -x $path ]] || fail 'Invalid Docker CLI plugin path'
  mounts+=(--mount "type=bind,src=$path,dst=/usr/local/lib/docker/cli-plugins/docker-$name,readonly")
  [[ $name != compose ]] || compose_found=true
done
[[ $compose_found == true ]] || fail 'Docker Compose plugin is required'

# Host PID namespace makes owner PID lock checks consistent across
# scheduled backups and releases. Long stop grace allows interrupted recovery.
if [[ $mode == --check ]]; then
  set -- -e 'const c=require("node:child_process"); console.log(JSON.stringify({node:process.version,docker:c.execFileSync("docker",["version","--format","{{.Server.Version}}"],{encoding:"utf8"}).trim(),compose:c.execFileSync("docker",["compose","version","--short"],{encoding:"utf8"}).trim(),git:c.execFileSync("git",["--version"],{encoding:"utf8"}).trim(),python:c.execFileSync("python3",["--version"],{encoding:"utf8"}).trim()}))'
fi
env_args=(--env "PHYSICSOS_DIR=$project_dir")
for name in PHYSICSOS_BACKUP_KEY_FILE PHYSICSOS_BACKUP_OFFSITE_DIR PHYSICSOS_BACKUP_RETENTION_DAYS PHYSICSOS_FULL_BACKUP_DIR PHYSICSOS_BACKUP_DIR PHYSICSOS_POSTGRES_SERVICE PHYSICSOS_BACKUP_STAMP; do
  [[ ! -v $name ]] || env_args+=(--env "$name=${!name}")
done
exec docker run --rm --read-only --tmpfs /tmp --network host --pid host \
  --stop-timeout 900 --user 0:0 --workdir "$project_dir" \
  "${env_args[@]}" "${mounts[@]}" --entrypoint node "$tools_image" "$@"
