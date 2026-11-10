# 线上环境不可用诊断与复盘（2026-10-22）

- 入口：`https://physics.dongsiwei.com`
- 服务器：`38.76.190.3`（`/opt/physicsos`，Docker Compose：app / postgres / redis）
- 结论：**主机在 2026-10-16 09:36（CST）被 ACPI“电源键”正常关机，之后停机 6 天 11 小时，
  2026-10-22 20:55（CST）由用户重启后恢复。** 不是应用崩溃、不是 OOM、不是磁盘满、
  不是证书或 nginx 故障；数据完整，无需恢复操作。

## 1. 故障时间线

| 时刻（CST） | 事件 |
| --- | --- |
| 2026-10-16 09:36:39 | `systemd-logind: Power key pressed short.` → `Powering off...` |
| 2026-10-16 09:37:08 | 系统完成优雅关机（`poweroff.target`），容器随之停止 |
| 2026-10-16 09:37 – 2026-10-22 20:55 | **停机 6 天 11 小时 17 分**，主机不响应 ICMP/TCP |
| 2026-10-22 20:34 | 开始排障：DNS 正常，全球多节点 `No route to host` |
| 2026-10-22 20:55 | 用户重启服务器，主机恢复 |
| 2026-10-22 20:59 | 三个容器 healthy，`/healthz` 与 `/readyz` 均 200 |

关键日志（上一启动会话末尾）：

```text
2026-10-16T01:36:39+00:00 systemd-logind[827]: Power key pressed short.
2026-10-16T01:36:39+00:00 systemd-logind[827]: Powering off...
2026-10-16T01:36:40+00:00 systemd-logind[827]: System is powering down.
2026-10-16T01:37:08+00:00 systemd[1]: Reached target poweroff.target - System Power Off.
```

`last -x` 同样记为 `shutdown system down ... Fri Oct 16 01:37 - 12:55 (6+11:17)`，
`journalctl --list-boots` 在 `-1` 与 `0` 之间正好缺这 6 天。

## 2. 为什么判定是“电源键关机”

- 是**优雅关机**：systemd 依次停止服务、卸载文件系统、停 journal，没有 panic、
  没有 OOM kill、没有磁盘只读，也没有内核崩溃痕迹。
- 触发源是 **ACPI power button 事件**（`Power key pressed short.`），而不是
  `reboot`、`shutdown` 命令或 `systemctl poweroff`。VPS 供应商控制台上的
  “关机/停止实例”就是通过 ACPI 电源键下发的；也可能是有人在控制台点了关机。
- 关机前最后 1 分钟没有 SSH 登录会话，只有公网扫描噪音（`Invalid user admin` 等），
  因此不是被入侵后关机。
- 2026-10-16 前后有 `unattended-upgrades` 活动，内核从 `6.8.0-142` 升到 `6.8.0-147`，
  但自动升级只会在需要时重启，不会在 01:36 触发 ACPI 电源键关机。

**最可能的原因：供应商侧暂停/关机，或控制台误操作。** 鉴于本项目没有欠费预警，
建议在供应商后台确认 10-16 09:36 的实例操作记录与账单状态，并开启到期/欠费提醒。

## 3. 排障过程（恢复前）

### 3.1 DNS 正常，仍指向原 IP

Google DoH 与 Cloudflare DoH 均返回：

```text
physics.dongsiwei.com. 600 IN A 38.76.190.3
NS: dns21.hichina.com / dns22.hichina.com
```

### 3.2 全球多节点不可达，但同网段邻居正常

[check-host.net](https://check-host.net) 多节点结果：

| 探测 | 结果 |
| --- | --- |
| HTTPS `physics.dongsiwei.com` | 巴西/德国/西班牙/以色列/伊朗×2：`No route to host` |
| TCP `38.76.190.3:22` | 巴西/伊朗/哈萨克斯坦/塞尔维亚：`No route to host` |
| TCP `38.76.190.3:443` | 伊朗×2/摩尔多瓦：`No route to host`；美国：超时 |
| TCP `38.76.190.3:80` | 瑞士/荷兰/土耳其：`No route to host`；哈萨克斯坦：超时 |
| ICMP `38.76.190.3` | 澳大利亚/瑞士/斯洛文尼亚：`TIMEOUT` / `DEST_UNREACH` |

对照：`38.76.184.1`、`38.76.185.1`、`38.76.188.1`、`38.76.189.1`、`38.76.191.1`
（同 /21、/22 网段）全部 ping 正常。说明不是整段路由或地区封锁，而是本机不在线。

RIPE RIS 显示 `38.76.188.0/22` 仍由 AS401701（cognetcloud INC）公告，
159/164 观测点可见——网段在路由表里，但主机不响应任何协议，与“实例已关机”完全一致。

本机侧一致：直连 `Network is unreachable`；走本机代理对站点返回 `502`/TLS 重置，
而同一代理访问 `example.com` 正常。

## 4. 恢复后核验（2026-10-22 20:59–21:05 CST）

| 项目 | 结果 |
| --- | --- |
| 主机 | 已启动，`uname -r` 6.8.0-147-generic |
| 容器 | `physicsos-app-1`、`physicsos-postgres-1`、`physicsos-redis-1` 均 `Up (healthy)` |
| 运行镜像 | `physicsos-app:global-a25c6ee26583`（= 远端 `main` 的 `a25c6ee`） |
| 服务器检出 | `/opt/physicsos` @ `a25c6ee26583b80ec40e75665cd3d1a92b54f6de`，无本地改动 |
| 健康检查 | `/healthz` → `{"status":"ok"}`；`/readyz` → `{"status":"ready",checks:{postgres:ok,redis:ok}}` |
| HTTPS | 200，nginx/1.24.0，安全响应头齐全 |
| 证书 | `CN=physics.dongsiwei.com`，有效期至 2026-12-25 |
| 磁盘 | 78G 用 54G（70%），剩 24G |
| 数据卷 | `app_data` 15M（54 个会话）、`postgres_data` 69M（`physicsos` schema 84 张表）、`redis_data` 316K |
| 每日备份 | `/opt/physicsos/backups/postgres/` 最近一份 `20261015T021501Z` |

**重要修复点：本次断线时长里，2026-10-15 23:06 之后就没有新的 PostgreSQL 每日备份，
直到主机恢复。停机期间的数据本来也不会变化（服务未运行），但说明备份任务与主机同生共死。**

## 5. 遗留风险与建议

1. **异地备份缺失（最高优先级）**：`scripts/deploy/backup-lib.mjs` 的 `copyOffsite()`
   只是在同一台主机的另一个目录里复制，文档也没有对象存储/另一台机器的配置。
   如果这次磁盘没救回来，业务数据将无法恢复。建议把每日 dump 推到对象存储（COS/OSS）
   或另一台机器，并做一次真实恢复演练。
2. **关机/欠费告警**：加一条外部可用性监控（如 UptimeRobot/BetterStack）指向
   `/healthz`，以及供应商账单到期提醒。本次故障 6 天无人知晓，正是缺这两项。
3. **`unattended-upgrades` 自动升级内核**：如需可控，改为维护窗口手动升级并记录重启。
4. **恢复演练**：`docs/restore-drill.md` 的步骤应在异地副本上重跑一次，确认可用。

## 6. 与项目接续的关系

- 本次故障与实验美化改动无关：那批改动从未发布，主机停机时运行的仍是 `a25c6ee` 镜像。
- 代码侧不受影响，本地仓库与 `overlays/` 未提交改动都在。
- 主机已恢复，按项目约定继续在服务器 Docker 环境验证实验美化改动。
