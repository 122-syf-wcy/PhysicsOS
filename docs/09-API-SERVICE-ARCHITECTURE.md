# PhysicsOS API & Service Architecture

> 文件：`docs/09-API-SERVICE-ARCHITECTURE.md`  
> 文档定位：PhysicsOS 服务边界、API 规范、跨服务通信与运行职责

---

# 1. 目标

PhysicsOS 不为了“微服务数量”而拆服务，而是围绕明确领域职责设计可演进边界。

初期可以：

```text
模块化单体
+
独立 Agent / Math / Document Runtime
```

后续根据负载和团队规模拆部署。

---

# 2. 逻辑服务

```text
API Service
Agent Service
Simulation Service
Math Service
Document Service
```

---

# 3. API Service

推荐：

```text
Spring Boot
```

负责：

```text
Auth
User
Role
Permission
Curriculum
Question
Exam
Question Attempt
Learning
Teacher
Class
Assignment
Content
Analytics
Scene Metadata
Job Metadata
```

不负责：

```text
Agent Loop
Physics Solver
OCR/VLM
Symbolic Math
```

---

# 4. Agent Service

负责：

```text
PhysicsAgentRuntime
DeepSeek Harness Adapter
Session
Run
Roles
Tools
Skills
Prompt
Context
Compaction
Memory
Model Router
Streaming
Trace
```

---

# 5. Simulation Service

负责：

```text
Server-side Physics Simulation
Heavy Simulation
Batch Simulation
Simulation Job
Simulation Artifact
Physics Verification
```

浏览器可运行的轻量实时 Physics Engine 不要求全部走服务端。

---

# 6. Math Service

推荐：

```text
Python + FastAPI
```

负责：

```text
Symbolic
Equation Solve
ODE
Matrix
Advanced Geometry
Root Finding
Optimization
Numerical
```

---

# 7. Document Service

负责：

```text
PDF
OCR
VLM
Page Analysis
Question Segmentation
Diagram Extraction
Document Job
```

---

# 8. Gateway

统一暴露：

```text
/api/v1/*
/agent/v1/*
/simulation/v1/*
/document/v1/*
/math/v1/*
```

---

# 9. Authentication

所有服务共享统一用户身份。

禁止：

```text
Agent Service 自建账号
Simulation Service 自建账号
```

---

# 10. Authorization Context

跨服务传递：

```text
userId
roles
permission scopes
traceId
```

---

# 11. Trace

推荐 Header：

```text
X-Trace-Id
```

如果上游未提供，则入口生成。

---

# 12. REST 设计

推荐：

```text
GET    /api/v1/questions/{id}
POST   /api/v1/questions
PATCH  /api/v1/questions/{id}

GET    /api/v1/scenes/{id}
POST   /api/v1/scenes
```

禁止 RPC 风格乱命名：

```text
/getQuestion
/createSceneNow
```

---

# 13. Agent API

推荐：

```text
POST /agent/v1/sessions
GET  /agent/v1/sessions/{id}

POST /agent/v1/sessions/{id}/messages

POST /agent/v1/runs/{id}/cancel
POST /agent/v1/runs/{id}/resume

POST /agent/v1/sessions/{id}/fork
```

---

# 14. Agent Streaming

优先：

```text
SSE
```

事件：

```text
run_started
status_changed
text_delta
tool_started
tool_completed
scene_changed
verification_completed
observation_changed
compaction_started
compaction_completed
run_completed
run_failed
```

---

# 15. Simulation API

```text
POST /simulation/v1/runs
GET  /simulation/v1/runs/{id}
POST /simulation/v1/runs/{id}/cancel
```

---

# 16. Document API

```text
POST /document/v1/jobs
GET  /document/v1/jobs/{id}
POST /document/v1/jobs/{id}/cancel
```

---

# 17. Math API

推荐：

```text
POST /math/v1/symbolic/simplify
POST /math/v1/equations/solve
POST /math/v1/ode/solve
POST /math/v1/geometry/intersections
```

---

# 18. Request / Response DTO

外部接口只暴露 DTO。

禁止：

```text
JPA Entity
ORM Model
Harness Internal Object
Engine Internal Object
```

直接出现在 API。

---

# 19. API Error

统一：

```json
{
  "error": {
    "code": "SCENE_REVISION_CONFLICT",
    "message": "Scene revision conflict.",
    "traceId": "trace_xxx",
    "details": {}
  }
}
```

---

# 20. HTTP Status

约定：

```text
200 Query Success
201 Created
204 Success No Content
400 Invalid Request
401 Unauthenticated
403 Forbidden
404 Not Found
409 Conflict
422 Domain Validation Failed
429 Rate Limited
500 Internal
503 Dependency Unavailable
```

---

# 21. Validation

入口至少：

```text
Schema Validation
Bean Validation / Zod / Pydantic
Permission
Domain Validation
```

---

# 22. Idempotency

任务型接口支持：

```text
Idempotency-Key
```

例如：

```text
Document Parse
Simulation Run
Bulk Generate
```

---

# 23. Timeout

所有跨服务请求必须设：

```text
connect timeout
request timeout
job timeout
```

---

# 24. Retry

自动 Retry 仅用于：

```text
网络瞬时错误
短暂 5xx
可重试 Rate Limit
```

以下不 Retry：

```text
INVALID_PARAMETER
SCENE_REVISION_CONFLICT
PHYSICS_CONSTRAINT_VIOLATION
```

除非上层有明确修复流程。

---

# 25. Circuit Breaker

对以下依赖建议建立：

```text
Model Provider
OCR / VLM Provider
Math Service
Object Storage
```

---

# 26. Rate Limit

重点：

```text
LLM
VLM
OCR
Document Parse
Simulation
Export
```

---

# 27. Queue

长任务：

```text
Exam Parse
Batch Question Parse
Long Simulation
Bulk Question Generation
```

进入 Queue。

---

# 28. Job Contract

统一：

```text
queued
running
needs_review
completed
failed
cancelled
```

---

# 29. WebSocket

仅用于真正双向实时：

```text
多人 Scene Collaboration
高频 Shared Scene Event
```

普通 Agent Streaming 优先 SSE。

---

# 30. Service-to-Service Security

后续生产可采用：

```text
Service Token
mTLS
Network Policy
```

---

# 31. OpenAPI

API Service 必须维护正式 OpenAPI。

客户端从 OpenAPI 生成 typed client。

---

# 32. Contract Source of Truth

禁止：

```text
OpenAPI 一份
TS Type 一份
Java DTO 一份
```

长期人工各自维护并漂移。

公共 Contract 应有单一来源或自动验证机制。

---

# 33. Client Generation

Web：

```text
packages/api-client
```

统一访问后端。

禁止页面散落 fetch。

---

# 34. API Compatibility

Minor：

```text
backward compatible
```

Breaking：

```text
新 API version
```

---

# 35. Health

每个服务：

```text
/health
/ready
```

---

# 36. Metrics

至少：

```text
request count
latency
5xx
dependency latency
queue depth
active jobs
```

---

# 37. File Upload

推荐流程：

```text
Init Upload
↓
Signed Upload
↓
Object Storage
↓
Confirm
```

避免大文件全部经过 API Service。

---

# 38. Download

使用：

```text
Signed URL
```

或受控流式下载。

---

# 39. Scene API 边界

API Service 管：

```text
Scene Metadata
Ownership
Share
Listing
```

Physics Runtime 管：

```text
Scene State
Events
Revision
Snapshot
```

---

# 40. Agent 修改 Scene

禁止：

```text
Agent Service
↓
直接 UPDATE scene_json
```

必须：

```text
Agent Tool
↓
Physics Runtime
```

---

# 41. Simulation Input

必须锁定：

```text
sceneId
sceneRevision
options
```

---

# 42. Document → Question

Document Service 产出解析结果。

Question 正式资源归 Business API 管理。

---

# 43. Resource Owner

每种核心资源必须唯一 Owner。

例如：

```text
Question → API Service
Agent Session → Agent Service
Physics Event → Physics Runtime
Document Job → Document Service
```

---

# 44. 禁止跨数据库读私有表

服务拆分后：

> A 服务不得直接查询 B 服务的私有数据库表。

通过：

```text
API
Event
Shared Contract
```

协作。

---

# 45. Async Event

未来可引入：

```text
QuestionParsed
SceneCreated
AssignmentSubmitted
LearningStateUpdated
```

用于异步解耦。

---

# 46. Service Package

每个服务应包含：

```text
README
API
Domain
Application
Infrastructure
Tests
Dockerfile
```

---

# 47. Contract Test

跨服务必须测试：

```text
request schema
response schema
errors
authorization
version compatibility
```

---

# 48. Graceful Degradation

Agent Service 不可用：

```text
已有 Physics Lab 仍可手工使用
```

Document Service 不可用：

```text
文本题仍可手工录入
```

Physics Engine 失败：

```text
不能伪装成功
```

---

# 49. Definition of Done

新接口必须具备：

```text
Contract
Validation
Auth
Permission
Error
Trace
Test
Metrics
Documentation
```

---

# 50. 一句话服务架构

> **PhysicsOS 的服务边界围绕领域事实和计算职责划分，使业务、Agent、物理仿真、数学和文档理解可以独立演进，而不通过数据库和隐式状态互相绑死。**
