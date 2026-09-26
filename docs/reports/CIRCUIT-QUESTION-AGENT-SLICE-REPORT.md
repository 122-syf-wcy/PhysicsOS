# 电路 Question Space 与 Agent 电路意图切片报告

> 日期：2026-09-08
> 状态：`CIRCUIT_QUESTION_AGENT_SLICE_COMPLETE`（已完成）
> 范围：`CIRCUIT_RUNTIME_PACK_V1` 报告「不做」清单点名的下一切片 —— Question Space 电路题全链路核实 + Agent 电路意图补齐。
> 电路引擎 / 场景 / 模板 / 可视化 / 实验室（MNA 直流引擎、21→38 模板、原理图画布）已在 `CIRCUIT_RUNTIME_PACK_V1_COMPLETE` 验收，本轮不重复。

---

## 1. 目标与现状核实

`CIRCUIT_RUNTIME_PACK_V1` 收口时明确「不做：Question Space 电路题与 Agent 电路意图（下一切片）」。本切片开工前先核实题目管线现状：

- **Question Space 电路题已就位**：`deterministic-circuit-parser`（`isCircuitQuestionText` 电路信号 + 电动势/内阻/电阻/电流/电压/功率提取 + 串联/并联/混联/滑变拓扑判定）、`circuit-scene-builder`（IR → `physics-scene/1.0` 场景）、`question-runtime` 电路分派（优先于电学判定）、`engine-selector` 路由 `CircuitEngine`、`golden-questions` 6 道黄金题（串联电流 / 并联总电阻 / 滑变电流 / 总功率与外功率 / 电流与路端电压 / 内阻题），QuestionWorkspace 经 `resolveCircuitOperatingPoint` + `circuitSceneVisualAt` 渲染可验证原理图 —— question-core 402 用例全绿覆盖。
- **Agent 侧缺口确认**：`physics-agent-answers.ts` 对 `domain === 'circuit'` 无任何意图；实验室 AI 助教对电路帧只能回「答不了」。本切片补齐 Agent 电路意图。

## 2. 交付物

| 路径                                                       | 内容                                                                                               |
| ---------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `ui-physicsos/src/client/physics/physics-agent-answers.ts` | 8 个电路意图 + 4 个辅助函数 + `matchIntent` 电路规则（置于复合场规则后、力学规则前，域闸门防串场） |
| `ui-physicsos/tests/physics-agent.client.spec.tsx`         | +10 电路意图用例（事实发布 / 拓扑分派 / 具名校验引用 / 路由 / 高亮可解析 / 域隔离）                |

高亮标签表（`HIGHLIGHT_LABELS`）在既有电路条目（bat / am / vm / sw / rv / r0-r3）已具备，本轮零改动；`CircuitAgentFacts`（内阻 / 滑变 / 结点数）与 `physicsAgentContext` 已随 `CIRCUIT_RUNTIME_PACK_V1` 就位，本轮只消费。

## 3. 意图设计

八个意图全部遵守「答案只复述运行时已产出的事实」：

| 意图                                                   | 闸门              | 引用的运行时事实                                                            |
| ------------------------------------------------------ | ----------------- | --------------------------------------------------------------------------- |
| `circuit-ohm-current`（这个电流是怎么来的）            | domain=circuit    | 派生量「干路电流 I」+ `kcl_current_conservation` 校验，公式 I = E/(R外 + r) |
| `circuit-terminal-voltage`（路端电压为什么比电动势小） | domain=circuit    | 派生量「路端电压 U」+ `terminal_voltage_law:<id>` 校验（U = E − I·r）       |
| `circuit-internal-resistance`（内阻有什么用）          | r > 0             | 派生量「内阻耗散功率」+ 路端电压定律校验，P内 = I²·r                        |
| `circuit-series-loop`（串联电流处处相等）              | junctionCount = 0 | 派生量「干路电流 I」+ KCL 校验                                              |
| `circuit-parallel-split`（电流在结点怎么分）           | junctionCount > 0 | 派生量「干路电流 I」+ KCL 校验，I支 = U/R支 反比分流                        |
| `circuit-rheostat-sweep`（滑片移动电流怎么变）         | hasSlider         | 派生量「接入电阻 R滑」+「干路电流 I」，R滑 = p·R全                          |
| `circuit-power-balance`（电源的功率去哪了）            | domain=circuit    | `power_balance` 校验 + 总/输出/内阻功率三派生量，P总 = P外 + P内            |
| `circuit-meters-ideal`（理想电表为什么不影响电路）     | 画布有 am/vm 符号 | `ideal_meters_non_intrusive` 校验                                           |

设计要点：

1. **拓扑分派读 `CircuitAgentFacts`，不猜标题。** `junctionCount`（并联结点）/ `hasSlider`（滑变符号）/ `internalResistance`（电源内阻）全部来自 Inspector 与画布投影 —— 串联帧永远不会声称结点分流，r = 0 的帧永远不会答「内阻有什么用」。
2. **校验按前缀匹配。** `terminal_voltage_law` 是每电源一条的 `terminal_voltage_law:<componentId>`，Agent 用 `startsWith` 找到这条「运行时的判定」，而不是自己重算 U = E − I·r。
3. **高亮目标动态取自画布。** `circuitComponentTarget` 优先当前帧真实绘制的电源 id（bat），其次电阻，再其次任一组件 —— 高亮永不指向不存在的东西；`resolveHighlightTarget` 对不绘制的 id 返回空集，工具层如实报告「画布当前没有显示」。
4. **域闸门防串场。** 电路规则在 `matchIntent` 中位于复合场规则后、力学/电学规则前，但每条意图的 `available` 都以 `domain === 'circuit'` 收口 —— 电磁感应题「求感应电流」、点电荷题「电流」都不会被电路意图截胡（有测试断言）。

## 4. 验收数据

- `pnpm typecheck:web` 零错误。
- `pnpm lint:web`（oxlint）零错误。
- `pnpm test:web`：30 文件 **376 用例全绿**。`physics-agent.client.spec.tsx` 62 用例（此前 52，+10 电路）；其中覆盖：四类电路模板的事实与 drawnIds 发布、按 facts 的拓扑分派、`circuit-ohm-current`/`circuit-terminal-voltage` 引用具名校验与派生量、内阻意图的 r > 0 闸门（r = 0 帧按 id 与关键词都被拒）、六条学生问法路由到正确意图、四帧 × 全部可用意图的高亮目标都能解析到真实绘制的符号、电路高亮为纯视图（revision 不变）、力学/电学帧完全不提供电路意图。
- `pnpm test:core`：全绿（question-core 402 含电路黄金题全链路；引擎/场景/校验无改动）。
- Agent 端到端 `headless-physics-acceptance` 与其余 acceptance 不受影响（本轮未触碰引擎、工具运行时与题库）。

## 5. 明确不做 / 边界

- **Question Space 电路题本体**：解析器 / 场景构建 / 运行时 / 6 道黄金题此前已交付并有测试，本轮仅核实未改动。
- **模型化 Agent 回答**：`AGENT_MODEL_BACKED_ANSWERS_BACKLOG` 不变 —— 接真实模型时仍只替换 `matchIntent`，本批意图的引用契约（派生量 + 具名校验 + highlight 工具调用）原样保留。
- **电路引擎 / 校验 / 模板扩展**：交流瞬态、电容电感、多电源仍按 `CIRCUIT_RUNTIME_PACK_V1` 边界由 `canHandle` 拒识。
- 未触碰：`packages/` 全部包、`apps/web`、Harness 上游历史。
