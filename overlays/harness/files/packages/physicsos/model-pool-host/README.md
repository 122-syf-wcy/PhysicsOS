# @deepseek-ai/dsh-model-pool-host

PhysicsOS 的平台模型兜底与 key 号池。设计参考 new-api 的「通道 / 密钥」模型，
但只保留这个部署真正需要的部分：一个本机 OpenAI 兼容代理、多通道多 key 的
加权轮训与故障转移、加密落库、后台可维护、以及谁改了什么。

## 它解决什么

过去模型链路是「一个 `DEEPSEEK_BASE_URL` + 一个 key」。key 一旦失效，全平台
的模型回合一起 401。现在：

```
Harness ──▶ http://127.0.0.1:<PHYSICSOS_MODEL_POOL_PORT>/v1
                     │  按 priority 分档 + 档内平滑加权轮训
                     ├─▶ 通道 A / key 1  ─┐
                     ├─▶ 通道 A / key 2  ─┤ 失败即换下一个候选
                     └─▶ 平台兜底通道     ─┘ 全部失败 → 明确错误，绝不伪造回复
```

## 关键行为

| 行为 | 取值 / 说明 |
| --- | --- |
| 密钥落库 | AES-256-GCM；密钥由 `PHYSICSOS_MODEL_POOL_SECRET` 经 HKDF-SHA256 派生。列表只回显尾 4 位。 |
| 轮训 | `priority` 越小越先跑，同档内平滑加权轮询（weight 累加选最大、再减总和）。 |
| 重试 | 默认 `retryCount=2`（最多 3 次尝试），且不超过候选数量；客户端错误（400/404/422）不换 key。 |
| 冷却 | 连续失败 `failureThreshold=3` 次，或任一 401/403，立即进入冷却；`cooldownBaseMs=30s` 起指数退避，上限 `cooldownMaxMs=30min`。 |
| 恢复 | `autoRecover=true` 时冷却到期自动回到服务；设为 false 需管理员在后台「恢复」。 |
| 流式 | 只在「响应头之前」重试。已经开始输出的流不会被重放，避免重复内容。 |
| 模型别名 | 通道的「模型列表」写的是**上游自己的模型名**；转发时用第一个替换平台侧的名字（如平台统一叫「平台公益模型」而上游只认 `minimax-m3`）。留空则原样透传调用方的模型名。选路不再按模型名过滤：任何启用通道都是候选，由 `priority` 决定先后。 |
| 全挂 | 返回 HTTP 503 + `MODEL_POOL_EXHAUSTED`（或 `MODEL_POOL_EMPTY` / `MODEL_POOL_NO_KEY` / `MODEL_POOL_ALL_COOLING`），带中文原因。 |
| 审计 | `channel.create/update/delete`、`key.create/update/delete/reset`、`settings.update`，只记尾号和参数，不记 key 值。 |

## 后台接口（仅 SUPER_ADMIN）

前缀 `/physicsos/model-pool`，写操作要求 `content-type: application/json`：

| 方法 | 路径 | 作用 |
| --- | --- | --- |
| GET | `/state` | 通道 + key（脱敏）+ 统计 + 审计 + 策略，一屏渲染 |
| POST | `/channels` | 新增通道 |
| PATCH / DELETE | `/channels/:id` | 修改 / 删除通道（删除会连带删除其 key） |
| POST | `/channels/:id/keys` | 新增 key（明文只在请求体内，落库即加密） |
| PATCH / DELETE | `/keys/:id` | 修改（含换 key）/ 删除 |
| POST | `/keys/:id/reset` | 清零失败计数、解除冷却 |
| POST | `/keys/:id/test` | 发一条 `max_tokens=1` 的最小请求，回报延迟与错误 |
| PATCH | `/settings` | 重试次数、失败阈值、冷却基数与上限、自动恢复 |

## 配置

| 配置 / 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `port` / `PHYSICSOS_MODEL_POOL_PORT` | `38972` | 代理监听端口（仅本机） |
| `host` / `PHYSICSOS_MODEL_POOL_HOST` | `127.0.0.1` | 代理绑定地址，不要改成 `0.0.0.0` |
| `PHYSICSOS_MODEL_POOL_SECRET`(`_FILE`) | 无 | 加密主密钥，缺失时后台只读、代理拒绝解密 |
| `PHYSICSOS_MODEL_FALLBACK_BASE_URL` | `https://api.deepseek.com/v1` | 空池时播种的兜底通道地址 |
| `PHYSICSOS_MODEL_FALLBACK_API_KEY`(`_FILE`) | 无 | 兜底 key；存在且池为空时自动建一个 `priority=100` 的通道 |

## 部署接线

1. `compose.yml` 里 `DEEPSEEK_BASE_URL` 指向 `http://127.0.0.1:${PHYSICSOS_MODEL_POOL_PORT}/v1`。
2. 增加 `model_pool_secret` secret 与 `PHYSICSOS_MODEL_POOL_SECRET_FILE`；它必须长期稳定，
   换掉等于所有已存 key 都要重新录入（`KEY_DECRYPT_FAILED`，不会静默用错 key）。
3. 原来的 `DEEPSEEK_API_KEY` 仍要保留一个非空值——Harness 的连接校验要求它存在，
   但代理不会再使用它。

## 测试

```sh
./node_modules/.bin/vitest run packages/physicsos/model-pool-host/tests
```
