# 线上环境不可用诊断（2026-10-22）

- 入口：`https://physics.dongsiwei.com`
- 服务器：`38.76.190.3`（`/opt/physicsos`，Docker Compose：app / postgres / redis）
- 结论：**主机本身在网络层失联，不是应用、Docker、nginx 或证书问题**。同一 /21、/22 网段的其他地址正常存活，只有这台主机（及它的 IP）不可达，符合“VPS 被关机 / 停机 / 欠费暂停 / IP 被回收”这一类供应商侧状态。
- 影响：无法 SSH、无法查看容器、无法发布或回滚；正式站点对所有访客不可用。

## 1. 实测证据（2026-10-22 20:34–20:50 CST）

### 1.1 DNS 正常，仍指向原 IP

Google DoH 与 Cloudflare DoH 均返回：

```text
physics.dongsiwei.com. 600 IN A 38.76.190.3
NS: dns21.hichina.com / dns22.hichina.com
```

即域名没有漂移，问题不在解析。

### 1.2 全球多节点均不可达

[check-host.net](https://check-host.net) 多节点结果（不同大洲）：

| 探测 | 节点结果 |
| --- | --- |
| HTTPS `physics.dongsiwei.com` | 巴西、德国、西班牙、以色列、伊朗×2：`No route to host` |
| TCP `38.76.190.3:22` | 巴西、伊朗、哈萨克斯坦、塞尔维亚：`No route to host` |
| TCP `38.76.190.3:443` | 伊朗×2、摩尔多瓦：`No route to host`；美国：`Connect timeout` |
| TCP `38.76.190.3:80` | 瑞士、荷兰、土耳其：`No route to host`；哈萨克斯坦：`Connection timed out` |
| ICMP `38.76.190.3` | 澳大利亚、瑞士、斯洛文尼亚：`TIMEOUT` / `DEST_UNREACH` |

关键对照：**同网段其他地址全部正常**：

| 地址 | 结果 |
| --- | --- |
| `38.76.184.1` | 法国、印尼、俄罗斯 ping OK（约 0.2 ms） |
| `38.76.185.1` | 香港、美国 ping OK |
| `38.76.188.1` | 以色列、美国 ping OK |
| `38.76.189.1` | 伊朗、荷兰 ping OK |
| `38.76.191.1` | 西班牙、乌克兰 ping OK |

所以不是整段路由或地区封锁，而是**这台主机/这个 IP 自身**从互联网上消失。

### 1.3 BGP 路由仍在公告

RIPE RIS（`stat.ripe.net`）显示 `38.76.188.0/22` 仍由 **AS401701（cognetcloud INC）** 公告，
159/164 个 RIS 观测点可见，路径 `... 2914 40779 401701 401701 401701`。
即“网段在路由表里”，但该网段内的这台主机不响应任何协议——常见于实例被供应商关机/挂起。

### 1.4 本机侧现象一致

- 直连：`ssh root@38.76.190.3` → `Network is unreachable`；`nc` 到 22/443/80 全部不可达。
- 走本机代理（127.0.0.1:7897）：`https://physics.dongsiwei.com/` → TLS 握手被重置；`http://` → `502 Bad Gateway`；同一代理访问 `example.com` 正常（200）。
- 其他已知用户服务器同样异常：`154.21.200.228:31058`、`216.167.70.94:2222` 全球多节点 TCP 超时；目前只有 `39.97.232.141:22` 可达。
  （这两台也可能只是端口白名单，但“多台同时异常”值得一并检查供应商账号状态。）

## 2. 排除项

- 不是 DNS：解析正确且 TTL 只有 600 秒，修改后会很快生效。
- 不是 nginx / 证书：TCP 层就到不了主机，任何 HTTP 层检查都无从谈起。
- 不是 Docker / Compose / 数据库：同样没有 SSH，容器状态不可知；此前 2026-10-15 23:06 的记录显示三个容器均 healthy。
- 不是本次实验美化改动：那批改动从未发布（见 [2026-10-15 报告](./2026-10-15-lab-visual-polish.md)），当时正式服务仍运行 `a25c6ee` 镜像且健康。

## 3. 恢复步骤（需要服务器控制台权限）

1. **登录 VPS 供应商控制台**，检查该实例状态：是否关机 / 到期欠费 / 被暂停 / 工单处理中；先尝试开机或续费。
2. 若实例已销毁或磁盘丢失：确认是否有快照/备份套餐；没有快照则只剩代码仓库可恢复，**账号、学习作答、会话数据会丢失**。
3. 若恢复后公网 IP 变化：到阿里云 DNS（`dns21/dns22.hichina.com`）把 `physics.dongsiwei.com` 的 A 记录改成新 IP。
4. 主机恢复后依次核对：
   ```sh
   ssh -i ~/.ssh/id_ed25519 root@38.76.190.3 \
     'cd /opt/physicsos && docker compose ps && docker compose images && git rev-parse HEAD'
   curl -sS https://physics.dongsiwei.com/healthz
   curl -sS https://physics.dongsiwei.com/readyz
   ```
   确认实际运行镜像仍是发布时的 `physicsos-app:global-a25c6ee26583`（或更新的已发布版本），再决定是否继续实验美化发布。
5. 长时间停机后检查 Let's Encrypt 证书有效期；到期前需在服务器恢复后重新签发。

## 4. 数据恢复风险

`scripts/deploy/backup-lib.mjs` 的 `copyOffsite()` 只是复制到**同一台主机的另一个目录**，
文档里也没有异地（对象存储/另一台机器）备份的配置。因此：

- 如果供应商能把实例救回来（磁盘完好）：PostgreSQL 卷、`app_data` 会话卷都还在，风险较低。
- 如果磁盘丢失：没有仓库内可用的异地备份，业务数据无法从代码仓库重建。

**这一条应在恢复后立刻补上异地备份**，否则下一次故障仍是同样的风险。

## 5. 与项目接续的关系

- 代码侧不受阻：本地仓库、`overlays/` 里的全部未提交改动都还在（见 [线程接续备忘](./2026-10-22-codex-thread-handover.md)）。
- 部署/验证受阻：按项目约定构建、测试、发布都必须在 `38.76.190.3` 的 Docker 环境完成，主机恢复前无法执行。
- 恢复后第一件事：重新核对远端 `main`、服务器检出版本、实际运行镜像，确认没有丢失已上线功能，再继续实验美化收尾。
