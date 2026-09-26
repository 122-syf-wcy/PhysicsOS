#!/usr/bin/env bash
# 一键部署 PhysicsOS 服务端（Ubuntu/Debian，root）。
#
#   curl -fsSL https://raw.githubusercontent.com/122-syf-wcy/PhysicsOS/main/scripts/deploy/deploy-server.sh | bash
#
# 幂等：可重复执行；已存在的 secret 不会被覆盖。
# 需要先准备的只有一个文件：$DIR/.env.deepseek_api_key（模型 key）。
set -euo pipefail

REPO=${PHYSICSOS_REPO:-https://github.com/122-syf-wcy/PhysicsOS.git}
DIR=${PHYSICSOS_DIR:-/opt/physicsos}

say() { printf '\n\033[1;36m==> %s\033[0m\n' "$*"; }

say "基础依赖"
apt-get update -qq
apt-get install -y -qq git curl ca-certificates openssl
if ! command -v docker >/dev/null 2>&1; then
  say "安装 Docker"
  curl -fsSL https://get.docker.com | sh
fi
docker compose version >/dev/null 2>&1 || apt-get install -y -qq docker-compose-plugin

say "拉取代码到 $DIR"
mkdir -p "$DIR" && cd "$DIR"
if [ -d .git ]; then
  git pull --ff-only || true
else
  git clone --recursive "$REPO" .
fi
git submodule update --init --recursive

say "生成本机 secret（已存在的保留）"
cd "$DIR"
umask 077
[ -s .env.postgres_password ] || openssl rand -hex 32 > .env.postgres_password
[ -s .env.redis_password ] || openssl rand -hex 32 > .env.redis_password
printf 'postgresql://physicsos:%s@postgres:5432/physicsos\n' "$(cat .env.postgres_password)" > .env.database_url
printf 'redis://:%s@redis:6379/0\n' "$(cat .env.redis_password)" > .env.redis_url
[ -s .env.admin_password ] || openssl rand -hex 16 > .env.admin_password
[ -s .env.image_api_key ] || printf 'placeholder-set-later\n' > .env.image_api_key

if [ ! -s .env.deepseek_api_key ] || grep -q '^replace-with' .env.deepseek_api_key 2>/dev/null; then
  printf '\n\033[1;31m缺模型 key\033[0m：请把 key 写进 %s/.env.deepseek_api_key ，然后重跑本脚本。\n' "$DIR"
  printf '  例：  printf %%s "sk-xxxx" > %s/.env.deepseek_api_key && chmod 600 %s/.env.deepseek_api_key\n' "$DIR" "$DIR"
  exit 1
fi

say "构建镜像（首次约 10-15 分钟）"
docker compose build

say "启动"
docker compose up -d
sleep 45
docker compose ps

say "自检"
curl -fsS --max-time 10 http://127.0.0.1:3080/healthz || true
echo
curl -fsS --max-time 10 http://127.0.0.1:3080/readyz || true
echo

say "完成"
cat <<EOF
访问地址： http://<本机公网IP>:3080
管理员：   admin  /  $(cat .env.admin_password)
           （租户 PHYSICSOS-OPEN，登录后请立即改密）
反代到 HTTPS 后，记得在 compose 环境里设置 PHYSICSOS_TRUSTED_PROXIES=<反代精确IP>
日志：     cd $DIR && docker compose logs -f app
停止：     cd $DIR && docker compose down
EOF
