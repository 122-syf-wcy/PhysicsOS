# 新服务器部署记录（2026-10-27）

- 新服务器：`107.151.246.59`（Hostinger，Ubuntu 24.04，x86_64，4 核 / 3.9GB / 49GB，香港）
- 旧服务器：`38.76.190.3` —— 部署当日全网不可达，未做数据迁移（用户确认全新开始）
- 代码版本：`origin/main`（含本日两个修复）
- 容器：`app` / `postgres` / `redis` 全部 healthy，`/healthz` 与 `/readyz` 均 200

## 1. 注册缺陷的两个根因

两份独立缺陷，任一份都足以让普通用户注册失败。

### H1 校名必须命中贵州花名册

注册页是自由文本框（`AuthGate.tsx`），无列表、无搜索、无「申请开通」入口；
服务端 `resolveSchoolByName` 只匹配种子名录，未命中即 `SCHOOL_NOT_FOUND`。
实测：`贵阳一中`（口语名）400、`贵州大学` 409 歧义、外省学校 400。
`docs/HANDOVER.md` 早先记录的契约是「注册时自动建租户」，而代码从未合入过该实现——
列表与申请面板被删掉的同时，兜底没有跟上。

修复：未命中时自动建立 active 租户，id 取归一化校名的哈希前缀，同一写法永远落在
同一租户，并发首注册不会分叉；任何状态下的同名学校都不重建，管理员的停用/改名/
合并得以保留。

### H2 CSRF 依赖反代信任

`checkCsrf` 比对 `Origin` 与 `${requestScheme(req)}://${host}`。而 `requestScheme`
只在 peer 属于 `trustedProxies` 时才认 `X-Forwarded-Proto`，否则返回 `http`。
TLS 终结在 nginx 时，浏览器发的是 `https://…` Origin，两者永不相等 → **所有**浏览器
POST（注册/登录/登出/找回密码）全 403「跨站请求被拒绝」。curl 不发送 Origin，
所以命令行探测一直是好的，这个故障因此长期未被发现。

修复：以 host 相等作为跨站边界（外来页面无法伪造本站 Origin），仅在传输层可靠报告
https 时才断言 scheme，降级场景仍拒绝。

两处均附回归测试；`auth.spec.ts` + `proxy.spec.ts` 35 passed。原本固化错误契约的
两条用例按新契约改写。

## 2. 镜像构建：为什么必须绕开 Dockerfile 的两阶段流程

这台机器上行带宽约 **1.2MB/s**（实测 Cloudflare 1.18MB/s、GitHub 1.16MB/s）。上游
`Dockerfile` 的 builder 阶段要装约 1700 个包，pnpm 默认 16 并发把带宽切得过细，
大包（mermaid 17MB、pdf/sherpa 各 ~11MB）活不过单请求超时，安装每次都在 ~5 分钟
处整体失败。即便降到并发 2、换国内镜像、`fetch-timeout` 拉长到 30 分钟，仍有
`TimeoutError`。

最终定位到真正的放大器：**该主机只有 link-local IPv6，没有全局 IPv6 路由，而 npm
源发布 AAAA 记录**。Node 默认 `verbatim` 解析顺序把不可达的 IPv6 地址先交给 socket，
请求就一直等超时而不是回落到 IPv4。同一份 16.8MiB 下载加
`--dns-result-order=ipv4first` 后 98.8s 完成。该修正已提交进 `Dockerfile` 的
builder 阶段 ENV（对所有 node/pnpm 子进程生效）。

即便如此，全量两次 install 仍需 ~21 分钟且脆弱，故本次部署采用如下**等价流程**，
产物与两阶段构建一致：

1. 用 host 网络起一个容器，挂载宿主 store（`--store-dir=/store`），顺序完成
   root 与 `vendor/deepseek-harness` 两次 `pnpm install`（`--network-concurrency=1`）；
2. 在容器内按 Dockerfile 的原顺序执行：overlay apply → `build:native-system`
   （需 `gcc`）→ `build:lib` → native flock 探针 → `build:web`；
3. 把完成的树 `docker cp` 出来，用 `runtime.Dockerfile` 只重放 runtime 阶段
   （pandoc/LibreOffice/字体 + 入口脚本 + HEALTHCHECK）。

**注意顺序陷阱**：overlay 必须在 install *之前* apply。反过来做（先 install 再
overlay）会让 overlay 新增的 workspace 包没有 node_modules 链接，`build:lib` 报
`Cannot find module 'zod'`。

后续重建建议：要么在带宽充裕的机器上构建后 `docker save`/`load`，要么保留上述
预构建流程；直接 `docker compose build` 在这台机器上仍然不可行。

## 3. 部署面配置

- `.env`：`PHYSICOS_TRUSTED_PROXIES=172.18.0.1`、`PHYSICOS_TRUSTED_HOSTS=physics.dongsiwei.com`

  **这一项踩过一次坑，值得记住**：nginx 与 app 不同容器，app 看到的反代 peer 是
  compose 网桥网关 `172.18.0.1`，不是文档示例里的 `127.0.0.1,::1`（那组只在
  nginx 与 app 同宿主 loopback 时成立）。配错的表现很隐蔽——站点能用、注册也返回
  201，只是会话 Cookie 少了 `Secure`（`cookies.ts` 依 `requestScheme` 决定），
  并且 `clientAddress` 退回成代理地址、全站共用一个限流桶。用 `/me` 拿到的
  `Set-Cookie` 第 4 个字段即可判定：`TRUE` 才是对的。
- 七个 secret 由 `secure-secrets.sh` 落到 `999:999 0400`；`model_pool_secret` 首次生成后不可更换
- nginx：TLS 终结 + `proxy_buffering off`（SSE）+ 1 小时读写超时 + gzip + 五项安全头
- 运维：`install-operations.sh`（fail2ban + 每日 02:15 备份 + logrotate）、首次备份已成功
- TLS：Let's Encrypt 已签发（到期 2027-01-25），`certbot renew --dry-run` 通过；
  nginx 1.24 需用 `listen 443 ssl http2;`，`http2 on;` 是 1.25+ 语法；`certonly`
  安装缺 `options-ssl-nginx.conf` / `ssl-dhparams.pem`，本机已补齐

## 4. 上线验收（2026-10-27 完成）

DNS A 记录已切至 `107.151.246.59`，HTTPS 站点上线。实测：

| 项 | 结果 |
| --- | --- |
| `GET /` | 200，34,628B，0.30s |
| `GET /readyz` / `/healthz` | 200 / 200 |
| HTTP → HTTPS | 301 |
| TLS | HTTP/2 |
| 注册：口语校名「贵阳六中」 | **201**（自动建租户，原为 400） |
| 注册：花名册校名「贵阳市第三实验中学」 | 201 |
| 注册：跨站 Origin | 403（安全未放宽） |
| 未登录访问 `/physicsos/admin/dashboard` | 401 |
| 会话 Cookie | 含 `Secure` + `HttpOnly` |
| 证书续期 | `certbot renew --dry-run` 通过 |

管理员账号为 `admin`（密码见服务器 `/opt/physicsos/.env.admin_password`，
租户 `PHYSICSOS-OPEN`，登录后应立即改密）。
