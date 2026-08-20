# PhysicsOS Data & Storage Architecture

> 文件：`docs/10-DATA-STORAGE-ARCHITECTURE.md`  
> 文档定位：PhysicsOS 数据事实源、持久化、缓存、事件、对象存储与检索体系

---

# 1. 最高原则

不同数据必须有明确事实源。

禁止：

```text
一个数据库保存一切语义
一个 Vector Store 什么都当 Memory
Redis 保存唯一永久数据
Harness Session 代替 Physics Event
```

---

# 2. 总体存储

```text
PostgreSQL
Object Storage
Redis
Vector Store
Physics Event Store
Harness Session Store
```

---

# 3. 三大事实源

```text
Business DB
→ 业务事实

Physics Event Store
→ 物理世界事实

Harness Session Store
→ Agent 运行事实
```

---

# 4. PostgreSQL

保存：

```text
User
Role
Permission
Question
Exam
QuestionAttempt
LearningState
Curriculum
Class
Assignment
Teacher Content
Scene Metadata
Skill Metadata
Job Metadata
Audit Metadata
```

---

# 5. Physics Event Store

逻辑上单独定义。

记录：

```text
scene_id
revision
event_id
type
payload
actor
trace
occurred_at
```

Event 不可修改。

---

# 6. Scene Snapshot

Metadata 可存 PostgreSQL。

大 Snapshot：

```text
Object Storage
```

---

# 7. Object Storage

保存：

```text
PDF
Image
Question Image
Scene Asset
Scene Snapshot
Simulation Artifact
Export
Report
Generated Asset
Temporary Normalized File
```

---

# 8. Redis

只用于：

```text
Cache
Rate Limit
Lock
Queue
Temporary Runtime State
Simulation Cache
Short-lived Session Data
```

---

# 9. Vector Store

用于：

```text
Curriculum Retrieval
Question Retrieval
Knowledge Retrieval
Teacher Material Retrieval
```

不存 PhysicsScene 真实状态。

---

# 10. Harness Session Store

保存：

```text
Agent model-visible session events
Tool Calls
Tool Results
Conversation
Compaction Events
```

---

# 11. ID

统一稳定 ID。

推荐全项目选一种：

```text
UUIDv7
```

或：

```text
ULID
```

不可混乱。

---

# 12. 时间

数据库统一：

```text
UTC
```

---

# 13. User

建议字段：

```text
id
display_name
role
status
created_at
updated_at
```

---

# 14. Question

```text
id
revision
stem
source_type
difficulty
grade
knowledge_tags
status
created_at
updated_at
```

---

# 15. Exam

```text
id
title
source_document_id
question_count
status
```

---

# 16. QuestionAttempt

```text
id
user_id
question_id
question_revision
answer
score
result
submitted_at
```

---

# 17. LearningState

必须版本化。

建议保留：

```text
revision
updated_at
```

重要更新可另外留 Event / Evidence。

---

# 18. SceneMetadata

```text
scene_id
owner_id
title
current_revision
latest_snapshot_id
source_question_id
visibility
created_at
updated_at
```

---

# 19. PhysicsEvent 索引

至少：

```text
(scene_id, revision) UNIQUE
(scene_id, occurred_at)
trace_id
tool_call_id
event_type
```

---

# 20. Snapshot Metadata

```text
snapshot_id
scene_id
revision
object_key
sha256
schema_version
created_at
```

---

# 21. SimulationArtifact

```text
simulation_id
scene_id
scene_revision
engine_id
engine_version
status
artifact_key
sha256
created_at
```

---

# 22. Document

```text
document_id
owner_id
object_key
sha256
content_type
size
page_count
status
created_at
```

---

# 23. Parse Job

```text
job_id
document_id
status
progress
parser_version
error_code
created_at
updated_at
```

---

# 24. Skill Metadata

```text
skill_id
version
domain
path
status
hash
```

---

# 25. Audit

记录：

```text
actor
action
resource_type
resource_id
result
trace_id
timestamp
```

---

# 26. Soft Delete

业务资源可以使用：

```text
deleted_at
```

但 Physics Event 不软删历史事件。

---

# 27. Hard Delete

用户主动删除个人数据时：

```text
business record
object file
derived cache
vector chunks
```

按策略清理。

---

# 28. Hash

文件建议：

```text
SHA-256
```

用于：

```text
integrity
dedup
artifact verification
```

---

# 29. Dedup

可以：

```text
同一用户内按 hash 去重
```

跨用户去重需考虑隐私。

---

# 30. Encryption

传输：

```text
TLS
```

敏感静态数据按部署环境启用加密。

---

# 31. Backup

必须覆盖：

```text
PostgreSQL
Physics Event Store
Harness Session Store
Object Storage metadata
Critical Assets
```

---

# 32. Restore

恢复时验证：

```text
hash
schemaVersion
event revision continuity
foreign references
```

---

# 33. Retention

定义：

```text
Temporary OCR Asset
Temporary Render
Simulation Chunk
Old Job Log
Application Log
```

生命周期。

---

# 34. Vector Chunk

必须携带：

```text
source_id
source_version
chunk_id
embedding_model
created_at
```

---

# 35. Re-embedding

Embedding 模型升级后支持重新生成。

旧 embedding 可逐步淘汰。

---

# 36. Scene 不进 Vector Truth

PhysicsScene 是结构化世界，不应被转成 embedding 后作为唯一 Scene 来源。

---

# 37. Cache Key

至少包含版本：

```text
scene:{id}:{revision}
question:{id}:{revision}
skill:{id}:{version}
simulation:{hash}
```

---

# 38. Cache Invalidation

Revision 变化后相关 Cache 必须失效。

---

# 39. Migration

数据库建议：

```text
Flyway
```

或等价方案。

---

# 40. Contract Migration

区分：

```text
Database Schema Migration
Domain Contract Migration
```

两者不是一回事。

---

# 41. Large Simulation Data

不要全部塞 PostgreSQL row。

采用：

```text
chunk
compression
object storage
metadata index
```

---

# 42. JSONB

适合：

```text
metadata
extensible config
```

不应该把所有核心关系都藏在 JSONB。

---

# 43. Search

普通筛选：

```text
PostgreSQL
```

全文：

```text
Search Index if needed
```

语义：

```text
Vector Store
```

---

# 44. Consistency

PhysicsScene：

```text
revision immutable
```

Business Resource：

```text
optimistic locking
```

---

# 45. Event Compaction

允许优化存储，但不能破坏：

```text
semantic replay
audit
revision
```

---

# 46. Snapshot Policy

建议按：

```text
event count
time
manual save
branch
```

综合创建。

---

# 47. Simulation Retention

普通临时模拟可以只保留最近或摘要。

被用户保存 / 题目关联 / 教师发布的结果应持久化。

---

# 48. Privacy

Learning State 与学生错误记录：

```text
最小访问权限
```

---

# 49. Observability

监控：

```text
DB latency
slow query
cache hit
queue depth
object latency
event append latency
```

---

# 50. Data Definition of Done

新数据模型必须明确：

```text
Owner
Schema
Index
Migration
Retention
Backup
Privacy
Test
```

---

# 51. 一句话数据架构

> **PhysicsOS 不建立一个混沌的“AI 数据池”，而是让业务事实、物理世界事实、Agent 运行事实和检索数据拥有独立、可恢复、可追踪的存储边界。**
