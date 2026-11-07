#!/usr/bin/env bash
# Publish the accepted website candidate on 107.151.246.59.
# Usage: deploy-website-server.sh <full pushed main commit> [--check-only]
# Config, secrets, application state and rollback points stay private on server.
set -Eeuo pipefail
umask 077
expected=${1:?full pushed main commit required}
[[ "$expected" =~ ^[a-f0-9]{40}$ ]] || exit 2
mode=${2:-publish}
[[ "$mode" = publish || "$mode" = --check-only ]] || exit 2
project=/opt/physicsos
release=/opt/physicsos-previews/website-release
stamp=20261108-official-website
recovery="$project/backups/releases/$stamp"
database_backup="$project/backups/postgres/$stamp"
publication=/opt/physicsos-previews/lab-visuals-release-20261105/physicsos-lab-production-publication.json
baseline_git=6189d95433b08afc5feedaf2b6b42d2d5755053b
baseline_image=sha256:75036307a61ac7842a59d1451ae803c7be89b37aa91b958dc6a25eab3c7662b1
rollback_tag=physicsos-app:rollback-official-website-20261108
channel_helper=/opt/physicsos-previews/question-visual-reliability-20261105/migrate-channels.py
stopped=0
checkout_changed=0
cd "$project"
exec 9> .physicsos-release.lock
flock -n 9
test ! -e "$recovery"
test ! -e "$database_backup"
test "$(git rev-parse HEAD)" = "$baseline_git"
git diff --quiet --ignore-submodules=untracked
git diff --cached --quiet
test "$(docker inspect physicsos-app-1 --format '{{.Image}}')" = "$baseline_image"
test "$(docker inspect physicsos-app-1 --format '{{.State.Health.Status}}')" = healthy
if docker image inspect "$rollback_tag" >/dev/null 2>&1; then
  printf '%s\n' 'Rollback tag already exists; choose a fresh release stamp.' >&2
  exit 1
fi
read -r accepted_image source_revision < <(python3 - "$release/accepted-validation.json" <<'GATE'
import datetime,json,sys
m=json.load(open(sys.argv[1]))
for key in ['passed','exactRuntimePassed','testsPassed','candidateSmokePassed','restartPersistencePassed']:
    assert m[key] is True, 'Incomplete gate: '+key
checked=datetime.datetime.fromisoformat(m['checkedAt'].replace('Z','+00:00'))
assert checked.tzinfo is not None
assert 0 <= (datetime.datetime.now(datetime.timezone.utc)-checked).total_seconds() <= 86400
print(m['imageId'],m['sourceRevision'])
GATE
)
[[ "$accepted_image" =~ ^sha256:[a-f0-9]{64}$ ]]
[[ "$source_revision" =~ ^[a-f0-9]{40}$ ]]
test "$accepted_image" != "$baseline_image"
test "$(docker inspect physicsos-website-candidate --format '{{.Image}}')" = "$accepted_image"
test "$(docker inspect physicsos-website-candidate --format '{{.State.Health.Status}}')" = healthy
python3 - "$release" <<'ISOLATION'
import json,pathlib,subprocess,sys
from urllib.parse import urlsplit
root=pathlib.Path(sys.argv[1])
inspect=lambda name:json.loads(subprocess.check_output(['docker','inspect',name]))[0]
app=inspect('physicsos-app-1');candidate=inspect('physicsos-website-candidate')
mounts=lambda value:{m['Destination']:m for m in value['Mounts']}
production=mounts(app);preview=mounts(candidate)
assert preview['/var/lib/physicsos']['Source']==str(root/'state')
assert preview['/var/lib/physicsos']['Source']!=production['/var/lib/physicsos']['Source']
for m in candidate['Mounts']:
    assert not (m['RW'] and m['Source'].startswith(production['/var/lib/physicsos']['Source']))
for name,expected_path in [('database_url','/physicsos_website_candidate_20261108'),('redis_url','/14')]:
    key='/run/secrets/'+name
    secret=pathlib.Path(preview[key]['Source'])
    assert secret==root/'secrets'/name
    candidate_url=urlsplit(secret.read_text().strip())
    production_url=urlsplit(pathlib.Path(production[key]['Source']).read_text().strip())
    assert candidate_url.path==expected_path and candidate_url.path!=production_url.path
print('PASS candidate database, Redis and writable state isolation')
ISOLATION
test "$(docker image inspect "$accepted_image" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}')" = "$source_revision"
docker exec physicsos-website-candidate node -e 'const f=require("fs"),c=require("crypto"),m=JSON.parse(f.readFileSync("/app/website-source-manifest.json"));if(m.baseImage!==process.argv[1]||m.source!==process.argv[2])process.exit(1);for(const [p,h] of Object.entries(m.files)){if(c.createHash("sha256").update(f.readFileSync("/app/"+p)).digest("hex")!==h)process.exit(1)}console.log("PASS candidate source manifest: "+Object.keys(m.files).length+" files")' "$baseline_image" "$source_revision"
export GIT_SSH_COMMAND='ssh -o BatchMode=yes -o ConnectTimeout=10 -o ConnectionAttempts=1 -o KexAlgorithms=ecdh-sha2-nistp256 -o IPQoS=none -o ServerAliveInterval=5 -o ServerAliveCountMax=2'
git fetch origin main > "$release/preflight-fetch.log" 2>&1
test "$(git rev-parse origin/main)" = "$expected"
git merge-base --is-ancestor "$baseline_git" "$source_revision"
git merge-base --is-ancestor "$source_revision" "$expected"
git diff --quiet "$baseline_git" "$expected" -- compose.yml compose.override.yml scripts/deploy/backup-postgres.sh
python3 - "$source_revision" "$expected" <<'SOURCE'
import subprocess,sys
paths=subprocess.check_output(['git','diff','--name-only',sys.argv[1],sys.argv[2]],text=True).splitlines()
assert all(p.startswith('docs/') or p in ['README.md','CHANGELOG.md','AGENTS.md'] for p in paths), 'Runtime changes follow accepted source; rebuild and revalidate'
SOURCE
backup_space() {
  # Uncompressed app data + full database size + 512 MiB reserve, minimum 1 GiB.
  python3 - "$project" <<'PY'
import os,subprocess,sys
raw=int(subprocess.check_output(['du','-sb','/var/lib/docker/volumes/physicsos_app_data/_data']).split()[0])
sql='SELECT pg_database_size(current_database())'
command=['docker','exec','physicsos-postgres-1','sh','-c','PGPASSWORD="$(cat /run/secrets/postgres_password)" exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -At -c "$1"','release-space',sql]
database=int(subprocess.check_output(command,stderr=subprocess.DEVNULL).strip())
stat=os.statvfs(sys.argv[1]); free=stat.f_bavail*stat.f_frsize
required=max(1024**3,raw+database+512*1024**2)
assert free>=required, 'Insufficient backup headroom: free='+str(free)+' required='+str(required)
print('PASS backup space: available='+str(free)+' required='+str(required))
PY
}
backup_space
if [[ "$mode" = --check-only ]]; then
  printf '%s\n' 'PASS website release preflight; production kept running.'
  exit 0
fi
install -d -m 0700 "$recovery"
printf '%s\n' "$baseline_image" > "$recovery/image.before"
printf '%s\n' "$baseline_git" > "$recovery/git.before"
printf '%s\n' "$expected" > "$recovery/git.expected"
printf '%s\n' "$source_revision" > "$recovery/source.expected"
printf '%s\n' "$accepted_image" > "$recovery/image.expected"
channels_verified() {
  python3 "$channel_helper" preflight "$recovery" > "$recovery/model-channel-$1.log" 2>&1
  mv "$recovery/model-pool.preflight.json" "$recovery/model-pool.preflight.$1.json"
  python3 - "$recovery/model-pool.preflight.$1.json" <<'PY'
import json,sys
report=json.load(open(sys.argv[1]))
assert report['passed'] is True and report['noMutation'] is True
assert report['existingMatchingChannels']==['HappyCoding','HualongAI','UltraRouter'], 'migrated channels are not all present and enabled'
PY
}

snapshot_pointers() {
  python3 - "$publication" "$1" <<'PY'
import hashlib,json,pathlib,subprocess,sys
table='u_'+hashlib.sha256(b'physicsos_experiments\x00state').hexdigest()[:60]
sql='SELECT value FROM physicsos."'+table+'" WHERE key_json=\'"convex-lens"\''
command=['docker','exec','physicsos-postgres-1','sh','-c','PGPASSWORD="$(cat /run/secrets/postgres_password)" exec psql --username="$POSTGRES_USER" --dbname="$POSTGRES_DB" -At -c "$1"','release-pointers',sql]
state=json.loads(subprocess.check_output(command,stderr=subprocess.DEVNULL))
names=[item['experimentId'] for item in json.load(open(sys.argv[1]))['packages']]
assert len(names)==len(set(names))==76
rows={row['id']:row for row in state['packages']}; snapshot=[]
archives=pathlib.Path('/var/lib/docker/volumes/physicsos_app_data/_data/experiment-packages')
for name in names:
    active=state['activeId'] if name=='convex-lens' else state.get('activeByExperiment',{}).get(name)
    row=rows[active]
    assert row['version']=='2.1.0' and row['status']=='approved', name+' current approved 2.1.0 package missing'
    assert row.get('experimentId','convex-lens')==name, name+' package identity differs'
    assert hashlib.sha256((archives/row['id']/'archive.zip').read_bytes()).hexdigest()==row['sha256'], name+' archive changed'
    snapshot.append({'experimentId':name,'packageId':row['id'],'sha256':row['sha256'],'version':row['version']})
data=json.dumps(sorted(snapshot,key=lambda row:row['experimentId']),sort_keys=True,separators=(',',':')).encode()
pathlib.Path(sys.argv[2]).write_bytes(data)
pathlib.Path(sys.argv[2]+'.sha256').write_text(hashlib.sha256(data).hexdigest()+'\n')
print('PASS current publication: 76 approved 2.1.0 pointers and 76 archive hashes')
PY
}

on_failure() {
  local status=$1
  local rollback_failed=0
  trap - ERR INT TERM
  set +e
  {
    if test "$checkout_changed" = 1; then
      if test "$(git rev-parse HEAD)" = "$expected"; then
        git reset --keep "$baseline_git" || rollback_failed=1
      elif test "$(git rev-parse HEAD)" != "$baseline_git"; then
        printf '%s\n' 'Git changed externally; manual checkout recovery required.'
        rollback_failed=1
      fi
    fi
    if test "$stopped" = 1; then
      docker tag "$baseline_image" physicsos-app:local || rollback_failed=1
      PHYSICSOS_APP_IMAGE="$rollback_tag" docker compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 app </dev/null || rollback_failed=1
      test "$(docker inspect physicsos-app-1 --format '{{.Image}}')" = "$baseline_image" || rollback_failed=1
      curl --fail --silent --show-error --max-time 20 https://physics.dongsiwei.com/readyz > "$recovery/ready.rollback.json" || rollback_failed=1
      python3 -c 'import json,sys; h=json.load(open(sys.argv[1])); assert h["status"]=="ready"; assert all(h["checks"][name]["status"]=="ok" for name in ["postgres","redis"])' "$recovery/ready.rollback.json" || rollback_failed=1
      if test -s "$recovery/pointers.before.json"; then
        snapshot_pointers "$recovery/pointers.rollback.json" || rollback_failed=1
        cmp "$recovery/pointers.before.json" "$recovery/pointers.rollback.json" || rollback_failed=1
      fi
    fi
    printf 'Rollback verification failed=%s\n' "$rollback_failed"
  } > "$recovery/rollback.log" 2>&1
  printf 'Release failed; recovery log: %s\n' "$recovery/rollback.log" >&2
  if test "$rollback_failed" = 1; then
    printf '%s\n' 'Automatic rollback needs manual attention; paired data recovery points are retained.' >&2
  fi
  exit "$status"
}
trap 'on_failure $?' ERR
trap 'on_failure 130' INT
trap 'on_failure 143' TERM

# Private config snapshots remain 0600 inside 0700 directories. No values print.
python3 - "$project" "$recovery" <<'PY'
import json,os,pathlib,shutil,subprocess,sys
project=pathlib.Path(sys.argv[1]); root=pathlib.Path(sys.argv[2]); config=root/'config'
config.mkdir(mode=0o700)
resolved=subprocess.check_output(['docker','compose','config','--format','json'],stderr=subprocess.DEVNULL)
(config/'compose.resolved.json').write_bytes(resolved)
for name in ['compose.yml','compose.override.yml','.env']:
    original=project/name
    if original.is_file(): shutil.copyfile(original,config/name)
secrets=config/'secrets'; secrets.mkdir(mode=0o700)
for name,entry in json.loads(resolved).get('secrets',{}).items():
    assert name.replace('_','').replace('-','').isalnum()
    source=pathlib.Path(entry['file']); source=source if source.is_absolute() else project/source
    assert source.is_file() and source.stat().st_size>0
    shutil.copyfile(source,secrets/name)
for directory,_,names in os.walk(config):
    for name in names: os.chmod(pathlib.Path(directory)/name,0o600)
nginx=subprocess.run(['nginx','-T'],capture_output=True,check=True)
(config/'nginx.before.txt').write_bytes(nginx.stdout)
os.chmod(config/'nginx.before.txt',0o600)
print('PASS private config snapshot: '+str(config))
PY
channels_verified before
snapshot_pointers "$recovery/pointers.before.json"
docker tag "$baseline_image" "$rollback_tag"
test "$(docker image inspect "$rollback_tag" --format '{{.Id}}')" = "$baseline_image"

# Recheck immediately before the only production interruption. Keep all data,
# current/rollback images, and old restore points; no pruning happens here.
backup_space
test "$(git rev-parse HEAD)" = "$baseline_git"
test "$(docker inspect physicsos-app-1 --format '{{.Image}}')" = "$baseline_image"
test "$(docker image inspect "$accepted_image" --format '{{.Id}}')" = "$accepted_image"
git fetch origin main > "$recovery/pre-switch-fetch.log" 2>&1
test "$(git rev-parse origin/main)" = "$expected"
stopped=1
docker compose stop --timeout 45 app </dev/null > "$recovery/stop.log" 2>&1
PHYSICSOS_BACKUP_RETENTION_DAYS=0 PHYSICSOS_BACKUP_STAMP="$stamp" scripts/deploy/backup-postgres.sh </dev/null > "$recovery/postgres-backup.log" 2>&1
(cd "$database_backup" && sha256sum -c postgres.dump.sha256) > "$recovery/postgres-check.log" 2>&1
test -s "$database_backup/postgres.list"
docker run --rm --network none --entrypoint tar --mount type=volume,src=physicsos_app_data,dst=/state,readonly node:24.7.0-bookworm-slim -czf - -C /state . </dev/null > "$recovery/app-data.tar.gz"
test -s "$recovery/app-data.tar.gz"
tar -tzf "$recovery/app-data.tar.gz" >/dev/null
(cd "$recovery" && sha256sum app-data.tar.gz > app-data.tar.gz.sha256 && sha256sum -c app-data.tar.gz.sha256) > "$recovery/app-data-check.log" 2>&1

checkout_changed=1
GIT_LFS_SKIP_SMUDGE=1 git merge --ff-only "$expected" > "$recovery/checkout.log" 2>&1
test "$(git rev-parse HEAD)" = "$expected"
PHYSICSOS_APP_IMAGE="$accepted_image" docker compose up -d --no-deps --no-build --force-recreate --wait --wait-timeout 180 app </dev/null > "$recovery/switch.log" 2>&1
test "$(docker inspect physicsos-app-1 --format '{{.Image}}')" = "$accepted_image"
curl --fail --silent --show-error --max-time 20 --retry 3 https://physics.dongsiwei.com/readyz > "$recovery/ready.after.json"
python3 - "$recovery/ready.after.json" <<'PY'
import json,sys
health=json.load(open(sys.argv[1])); assert health['status']=='ready'
for name in ['postgres','redis']: assert health['checks'][name]['status']=='ok'
PY
curl --fail --silent --show-error --max-time 20 --retry 3 https://physics.dongsiwei.com/ > "$recovery/home.after.html"
test -s "$recovery/home.after.html"
grep -q 'physicsos/website\|让好奇心' "$recovery/home.after.html"
curl --fail --silent --show-error --max-time 20 https://physics.dongsiwei.com/app > "$recovery/app.after.html"
curl --fail --silent --show-error --max-time 20 https://physics.dongsiwei.com/physicsos/notice/public/website > "$recovery/website-content.after.json"
snapshot_pointers "$recovery/pointers.after.json"
cmp "$recovery/pointers.before.json" "$recovery/pointers.after.json"
channels_verified after
docker tag "$accepted_image" physicsos-app:local
git rev-parse HEAD > "$recovery/git.after"
docker inspect physicsos-app-1 --format '{{.Image}}' > "$recovery/image.after"
trap - ERR INT TERM
printf 'PASS exact accepted image, HTTPS health, paired backups, 76 unchanged 2.1.0 packages and migrated model channels; recovery: %s\n' "$recovery"
