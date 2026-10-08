# PhysicsOS P0 Provenance 程序（可信溯源）

> 本文件记录 owner 已批准的验收标准与重排后的路线图。文档记录，不改动代码。

**目标：** 让「已验证」成为可运行的事实——任何用户可见的物理结论，只要声称 Verified，就必须可追溯到具体 Scene Revision、Engine、Verifier 与真实检查证据。

## 1. 架构原则（可引用原句）

> Verified is a property of evidence, not a presentation state.
> 「已验证」是证据的属性，不是 UI 的显示状态。

**推论：** UI、Agent、Paper 与 Question 都不得自行声明「已验证」；只有 PhysicsOS 的验证链路可以。

## 2. 规范链路

```
LLM / User / Question / Paper
            ↓
      Physics Semantic Input
            ↓
        PhysicsScene
            ↓
      Physics Engine
            ↓
         Verifier
            ↓
        Provenance
            ↓
    Verified Physics Result
            ↓
   UI / Agent / Paper / Export
```

注：Harness、模型与 UI 都可替换；`PhysicsScene → Engine → Verifier → Provenance` 属于我们，所有关键物理结论都必须经过它。

## 3. P0 收口标准（owner 五点）

1. **Provenance 是事实，不是标签**：`verificationLevel` 只能由真实 Verifier 检查推导；缺少 `engineId`、`sceneRevision` 或 Verifier 证据时，取值降级为 `UNVERIFIED`。禁止 `default: VERIFIED`，UI 不得自行判断。
2. **已验证 UI 只消费事实**：不得基于「结果看起来没问题」而显示绿色徽标；无 provenance 即显示 `Unverified`；UI 应绑定一个统一的标准 DTO，而不是逐页拼装字段。
3. **CI 门禁必须能红**：至少三个 fixture —— 模型直接产出的裸数字、缺少 `sceneRevision` 的取值，以及**伪造**的 `verificationLevel: STRONGLY_VERIFIED`（支撑检查不足）—— 门禁必须对三者都真实报红。
4. **空壳 Agent 包退场可执行**：先确认零生产消费方，再删除；ADR 由 Proposed 转为 Accepted/Executed；文档须写明 **Harness 是 Agent host**，不得暗示 PhysicsOS 维护自己的 Agent runtime。
5. **链路未跑通前不改宣传文案**：等 `Paper → Engine → Verifier → Provenance → Verified UI → CI Gate` 端到端真正可用之后再动，使「可验证」成为可运行的事实而非口号。

## 4. P0 验收（定义完成）

> 任何用户可见的物理结论，只要声称 "Verified"，就必须能够追溯到具体 Scene Revision、Engine、Verifier 和真实检查证据；否则一律视为 Unverified。

该验收须落地为**代码级不变量**，而不仅是一句政策。

## 5. 合并顺序

三个 P0 工作流并行开发不受限，但合并顺序固定为 `Provenance → Gate → UI`：UI 不得先落地，再对着仍在变动的类型反复返工。

## 6. 工作流与标准映射

| 工作流         | 承担的标准                                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Provenance** | 标准 1（`verificationLevel` 只由真实检查推导，缺证据降级 `UNVERIFIED`，禁 `default: VERIFIED`）；标准 4（空壳 Agent 包退场、ADR 转 Accepted/Executed、文档写明 Harness 是 Agent host）；验收的代码级不变量 |
| **Gate**       | 标准 3（三个负向 fixture，门禁真实报红）                                                                                                                                                                   |
| **UI**         | 标准 2（只消费事实、绑定统一 DTO、无 provenance 显示 `Unverified`）                                                                                                                                        |
| **全部工作流** | 标准 5（链路端到端可用前冻结宣传文案）是该程序的时序约束，跨全部工作流                                                                                                                                     |

## 7. P1 实验闭环排序（记录）

依据：打开实验 30 秒内，用户应能测量、探针、查看物理事件时间线并回放——这比再加一个 AI 面板更能证明存在真实的物理运行时。

`Measurement Tools → Physics Timeline → Experiment Notebook → Branch Compare → Question → World 可视化 → Challenge`

其中 Experiment Notebook 是上述行为的沉淀处，Challenge 是后续的增长入口。`docs/ROADMAP.md` 同步记录该排序。

## 8. 后续动作

- 架构原则（第 1 节）在 P0 收口时提升进 `docs/02-ENGINEERING-STANDARDS.md`（当前由其他 agent 占用该文件，故暂不写入，避免冲突）。
- 本文件为 P0 的记录与验收契约；实现明细以各工作流的实现报告为准。
