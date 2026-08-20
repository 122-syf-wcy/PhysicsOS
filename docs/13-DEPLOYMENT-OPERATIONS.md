# PhysicsOS Deployment & Operations

> 文件：`docs/13-DEPLOYMENT-OPERATIONS.md`  
> 文档定位：PhysicsOS 本地开发、环境、CI/CD、监控、备份、恢复与未来 Desktop 发布规范

---

# 1. 目标

定义：

```text
Local Development
Dev
Staging
Production
CI/CD
Observability
Backup
Restore
Rollback
Scaling
Desktop Release
```

---

# 2. 环境

统一：

```text
local
development
staging
production
```

禁止大量：

```text
prod2
test-final
staging-new
```

无规范环境。

---

# 3. Web 部署

学生 Web / Teacher Web / Admin Web：

```text
Static / Edge Hosting
+
CDN
```

构建产物 immutable。

---

# 4. API

部署为容器服务。

---

# 5. Agent Service

独立容器。

需要：

```text
model credential
session store
streaming
tool runtime
```

---

# 6. Simulation Service

使用 Worker 模式时可水平扩展。

---

# 7. Math Service

Python 独立容器。

---

# 8. Document Service

长任务建议：

```text
API
+
Job Worker
```

分离。

---

# 9. Docker

每个服务：

```text
Dockerfile
.dockerignore
healthcheck
```

---

# 10. Docker Compose

本地开发提供：

```text
PostgreSQL
Redis
Object Storage
Vector Store
```

---

# 11. Config

按：

```text
environment variables
config files
secret manager
```

分层。

---

# 12. Secret

生产 Secret：

```text
不进入镜像
不进入 Git
不进入前端
```

---

# 13. CI Pipeline

至少：

```text
install
format check
typecheck
lint
unit
contract
physics golden
build
```

核心分支增加：

```text
integration
agent regression
e2e
```

---

# 14. Artifact

构建产物：

```text
versioned
immutable
traceable to commit
```

---

# 15. CD

推荐：

```text
Build Once
↓
Deploy Staging
↓
Migration
↓
Smoke
↓
Promote
↓
Production Verification
```

---

# 16. Database Migration

部署前检查。

失败：

```text
停止发布
```

---

# 17. Rolling Compatibility

滚动部署期间：

```text
新旧服务短时间共存
```

API / DB 变更需兼容。

---

# 18. Health

每个服务：

```text
liveness
readiness
```

---

# 19. Metrics

应用：

```text
request count
latency
error rate
CPU
memory
```

依赖：

```text
DB
Redis
Object Storage
Queue
```

---

# 20. Agent Metrics

```text
run count
run duration
model latency
tool latency
tool error
compaction
token usage
cost
```

---

# 21. Physics Metrics

```text
simulation count
simulation duration
engine usage
verification failure
solver failure
cache hit
```

---

# 22. Document Metrics

```text
parse jobs
page throughput
OCR latency
failure rate
needs_review rate
```

---

# 23. Alert

重点：

```text
5xx spike
DB unavailable
Queue backlog
Model provider unavailable
Simulation failure spike
Storage failure
```

---

# 24. Logs

集中式结构化日志。

必须含：

```text
service
traceId
event
level
timestamp
```

---

# 25. Distributed Trace

打通：

```text
Web Request
API
Agent
Tool
Physics
Math
Document
```

---

# 26. Error Tracking

前端与服务端统一收集异常。

---

# 27. Backup

PostgreSQL：

```text
regular full backup
+
point-in-time recovery where possible
```

---

# 28. Physics Event Backup

必须包含。

---

# 29. Harness Session Backup

如果产品承诺历史 Agent 会话可恢复，则纳入备份。

---

# 30. Object Storage

重要 Bucket：

```text
versioning / lifecycle
```

---

# 31. Restore Drill

备份不是“有文件就行”。

必须定期：

```text
真正恢复
验证数据
验证 Scene Replay
```

---

# 32. Retention

明确：

```text
application logs
temporary OCR
temporary simulation
old jobs
old exports
```

生命周期。

---

# 33. Cost

主要成本：

```text
LLM
VLM
OCR
Storage
Egress
Heavy Simulation
```

---

# 34. Cost Attribution

按：

```text
user
session
question
model
service
```

记录。

---

# 35. Scaling

API：

```text
stateless horizontal scale
```

Agent：

```text
stateless runtime workers + persistent session
```

Simulation：

```text
job workers
```

Document：

```text
queue workers
```

---

# 36. Concurrency Limit

单用户限制同时：

```text
Agent Runs
Document Jobs
Heavy Simulations
```

---

# 37. Graceful Shutdown

Worker：

```text
停止接新任务
完成或安全取消当前任务
写回状态
```

---

# 38. Release Strategy

优先：

```text
small release
canary
feature flag
rollback
```

---

# 39. Feature Flag

未完全开放能力：

```text
Flag
```

管理。

---

# 40. Rollback

必须支持快速回滚：

```text
Web
API
Agent
Simulation
Config
```

---

# 41. DB Rollback

数据库 Breaking Migration 需要：

```text
expand
migrate
contract
```

而不是简单 down migration 赌数据。

---

# 42. Engine Version

发布时保留：

```text
engineVersion
```

旧结果仍可追踪。

---

# 43. Harness Upgrade

必须单独执行：

```text
Upgrade Branch
↓
Read Changelog
↓
Adapter Test
↓
Session Resume Test
↓
Tool Test
↓
Compaction Test
↓
Agent Golden
```

---

# 44. Desktop Build

未来：

```text
Tauri
Windows x64
```

可以后续增加 ARM64。

---

# 45. Desktop Signing

正式发布：

```text
签名
```

---

# 46. Auto Update

更新包：

```text
signed
versioned
rollback-aware
```

---

# 47. Sidecar

本地 Agent / Math / Physics Sidecar：

```text
版本必须与 App Compatible
```

---

# 48. Offline Capability

明确矩阵：

```text
Physics Lab 基础仿真：可离线
本地 Scene：可离线
Cloud Agent：不可离线
Cloud OCR：不可离线
```

未来可逐步扩展。

---

# 49. Status

生产可以提供：

```text
Service Status Page
```

---

# 50. Runbook

至少写：

```text
DB Down
Redis Down
Model Provider Down
Object Storage Down
Queue Stuck
Document Worker Down
Simulation Failure Spike
```

处理步骤。

---

# 51. Disaster Recovery

定义：

```text
RPO
RTO
```

正式商用前根据业务要求设定。

---

# 52. Operations Definition of Done

新服务上线前必须有：

```text
Docker
health
metrics
logs
alerts
backup strategy
restore strategy
runbook
resource limit
```

---

# 53. 一句话运维原则

> **PhysicsOS 的每一次发布、每一个 Agent Run、每一次 Simulation 和每一份用户数据都应该能够被观察、追踪、恢复和安全升级，而不是只有“服务现在能启动”。**
