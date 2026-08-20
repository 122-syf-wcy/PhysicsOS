# Mechanics Runtime Pack V1 — Report

> 文件：`docs/reports/MECHANICS-RUNTIME-PACK-V1-REPORT.md`
> 任务编号：`MECHANICS_RUNTIME_PACK_V1`

---

## 1. Mechanics Contracts

`packages/physics-scene` 扩展：
- `Body`（rigid_body）已有完整 Contract（mass, position, velocity, acceleration, shape, material）
- `Force` 已有完整 Contract（type: gravity, normal, friction, tension, spring, electric, lorentz, ampere, drag, custom；vector, targetId, model, derived）
- `GravityField` 已有完整 Contract（uniform_gravity, acceleration: QuantityVector）
- Scene validation 扩展：Body 单位/维度/有限性/质量正数检查，Body ID 加入 observable target 校验

新增 `mechanics-scene-factory.ts`：
- `createMechanicsScene(input)` — 根据 model 创建合法 PhysicsScene
- `createMechanicsSimulationRequest(scene, simId, traceId)` — 创建 SimulationRequest
- 支持 5 种 model + gravity, groundY, inclineAngle, frictionCoefficient, appliedForce

---

## 2. Engine Models

`packages/engine-mechanics` 新建：

- `M1 uniform_linear_motion` — x(t) = x0 + vt, a = 0, F_net = 0
- `M2 uniformly_accelerated_motion` — v(t) = v0 + at, x(t) = x0 + v0t + ½at²
- `M3 projectile_motion` — 统一平抛 + 斜抛（launchAngle = 0 即平抛）
  - flightTime, range, maxHeight, impactVelocity 计算
  - GroundImpact 事件生成
  - Timeline duration = impactTime
- `M4 newton_second_law` — ΣF = ma，支持 applied force + gravity + normal
- `M5 inclined_plane` — g sinθ, g cosθ, N = mg cosθ, f = μN, a = g(sinθ - μcosθ)

`mechanics-model-selector.ts`：
- `detectMechanicsModel(scene)` — 通过 title/description/observable/force/body 自动检测 model
- `resolveMechanicsModel(scene)` — 返回完整 MechanicsModel

---

## 3. Solver

- `analytical-kinematics.ts` — kinematicsAt(pos0, v0, a, t) 返回 position/velocity/acceleration
- `force-dynamics.ts` — newtonSecondLaw(m, forces[]), inclineAcceleration(m, g, θ, μ), inclineForceDecomposition(g, θ)

全部 analytical，无数值积分。

---

## 4. Scene Integration

- `MechanicsEngine` 实现 `PhysicsEngine<PhysicsScene>` 接口
- canHandle 检查：2D, single body, mass > 0, validateScene
- validate 调用 validateScene + canHandle
- stateAt 返回 closed-form state
- simulate 采样 65 点轨迹，计算 derivedQuantities，生成 verification

---

## 5. Verifier

`packages/physics-verifier` 扩展：
- `verifyNewtonSecondLaw(m, F, a)` — ΣF = ma 数值检查
- `verifyKinematicConsistency(v0, a, t, v, x, x0)` — v(t) = v0 + at 检查
- `verifyProjectileHorizontalVelocity(states, bodyId)` — vx constant 检查
- `verifyProjectileVerticalAcceleration(a, g)` — ay = -g 检查
- `verifyProjectileImpact(finalY, groundY)` — impact y ≈ groundY 检查
- `verifyInclineForceDecomposition(g, θ, gPar, gNorm, N, m)` — mg sinθ, mg cosθ 检查

Engine 内置 verification 在 simulate 中生成。

---

## 6. Observation

`packages/physics-observation` 扩展：
- PositionObservation, MechanicsVelocityObservation, AccelerationObservation
- ForceObservation, NetForceObservation
- MechanicsTrajectoryObservation
- DisplacementObservation
- ProjectileKeyPointObservation（launch, apex, impact）
- GroundObservation, InclineObservation

`observeMechanicsScene(input)` — 从 scene + simulation 生成 renderer-neutral observations

---

## 7. Lab

Lab UI 更新中 — 当前 Lab Workspace 仍以 Magnetic Runtime 为主。
Mechanics Lab Templates 和 Renderer 待 UI 阶段完成。

---

## 8. Question Parser

`packages/question-core` 扩展：
- `DeterministicMechanicsQuestionParser` — 识别中文力学题
- 支持：初速度、末速度、加速度、时间、位移、高度、质量、力、角度、摩擦系数、重力加速度、水平速度、抛射角
- 单位通过 `physics-units` 的 `parseQuantity` + `canonicalValue` 转换
- 不手工换算

---

## 9. Semantic IR

`PhysicsSemanticIR` 扩展：
- domain: 'mechanics'
- model: uniform_linear_motion | uniformly_accelerated_motion | projectile_motion | newton_second_law | inclined_plane
- 新增 targets: final_velocity, displacement, time, acceleration, range, max_height, flight_time, normal_force, friction_force, net_force, velocity
- 新增 relations: constant_velocity, constant_acceleration, free_flight, on_incline
- 新增 assumptions: no_air_resistance, constant_force, kinetic_friction, static_friction_pending
- 新增字段: inclineAngle, launchAngle, groundY, frictionCoefficient

`semantic-validator.ts` 扩展为 domain-aware：magnetic → validateMagneticIR, mechanics → validateMechanicsIR

---

## 10. Question Runtime

`question-runtime.ts` 重写：
- 自动检测 magnetic vs mechanics 题目
- 磁场 → DeterministicMagneticQuestionParser + MagneticEngine
- 力学 → DeterministicMechanicsQuestionParser + MechanicsEngine
- 统一 processQuestion 接口
- buildSolution 支持 5 种 mechanics model 的 step + result 生成

---

## 11. Renderer

MechanicsRenderer 待 UI 阶段完成。当前 LabCanvas 仅支持 magnetic。

---

## 12. Timeline

MechanicsEngine.stateAt 支持 Play/Pause/Seek/Step/Speed。
全部来自 analytical stateAt(t)，无 CSS 动画。

---

## 13. Golden Tests

### 磁场 Golden Questions（原有 49 tests）
- 10 个磁场题目全部通过
- Q09 单位转换（km/s + mT）现在通过 physics-units 正确转换

### 力学 Golden Questions（新增 64 tests）

Golden Questions（6 个）：
- mech-01: 匀加速 v0=10, a=2, t=5 → v=20, s=75 ✓
- mech-02: 平抛 h=20m, vx=10m/s, g=10 → t=2s, R=20m ✓
- mech-03: 斜抛 v0=20, θ=30°, g=10 → maxH, flightTime, range ✓
- mech-04: Newton m=2, F=10 → a=5 m/s² ✓
- mech-05: 斜面 m=2, θ=30°, g=10, μ=0 → a=5 m/s², N≈17.32N ✓
- mech-06: 单位转换 72 km/h → 20 m/s ✓

Engine Direct Tests:
- canHandle uniform linear / projectile / incline ✓
- rejects mass ≤ 0 ✓
- stateAt returns valid state ✓
- simulate produces states and derived ✓

Metamorphic Tests:
- projectile vx×2 → range×2, same flight time ✓
- newton F×2 → a×2 ✓
- incline mass×2 → acceleration unchanged ✓

Edge Cases:
- mass = 0 → unsupported ✓
- mass < 0 → unsupported ✓
- g = 0 projectile → no crash, no NaN ✓
- no NaN in simulation results ✓

---

## 14. Browser E2E

待 UI 阶段完成后执行。

---

## 15. Screenshots

待 UI 阶段完成后输出。

---

## 16. Known Limitations

- **Lab UI**：当前 Lab Workspace 仍以 Magnetic Runtime 为主，Mechanics Lab Templates 和 Renderer 待 UI 阶段
- **Scene Commands**：Mechanics Scene Commands（SetBodyMass, SetInitialPosition, SetLaunchAngle 等）待 V2
- **Static Friction**：V1 仅支持 kinetic friction (μN)，静摩擦平衡判断标记为 PENDING
- **Renderer**：MechanicsRenderer（平抛抛物线、斜面力分解图）待 UI 阶段
- **Data Panel**：x-t, v-t, a-t 图表待 UI 阶段
- **Agent "What If?"**：Tool Contract 预留，实现待 V2
- **Home/Recent Spaces**：待 UI 阶段更新

---

## 17. Harness Replay Deferred

```
HARNESS_WINDOWS_REPLAY_GATE_DEFERRED
```

---

## 18. Test Statistics

| Suite | Tests | Status |
|-------|-------|--------|
| Magnetic Golden Questions | 49 | PASS |
| Mechanics Golden Questions | 64 | PASS |
| **Total** | **113** | **PASS** |
| root typecheck | 16 tasks | PASS |
| root test | 21 tasks | PASS |

---

## 完成状态

- 5 个 Mechanics Model 可用 ✓
- MechanicsEngine 可处理 5 种模型 ✓
- Question Space 支持匀加速 + 平抛 + 斜抛 + Newton + 斜面真实求解 ✓
- Verifier PASS ✓
- Timeline stateAt 工作 ✓
- Unit Conversion 真正工作 ✓
- root typecheck PASS ✓
- root tests PASS ✓
- Physics Lab 平抛 + 斜面 UI — 待 UI 阶段
- Browser smoke — 待 UI 阶段
- Screenshots — 待 UI 阶段

MECHANICS_RUNTIME_PACK_V1_IN_PROGRESS

## 已完成

- ✅ 5 个 Mechanics Model 可用（engine-mechanics）
- ✅ MechanicsEngine 可处理 5 种模型
- ✅ Question Space 支持匀加速 + 平抛 + 斜抛 + Newton + 斜面真实求解
- ✅ Verifier PASS（engine 内置 + physics-verifier 扩展）
- ✅ Timeline stateAt 工作（analytical solver）
- ✅ Unit Conversion 真正工作（physics-units: km/h, km/s, mT, cm, g, ms）
- ✅ root typecheck PASS（16 tasks）
- ✅ root tests PASS（113 tests: 49 magnetic + 64 mechanics）
- ✅ Golden Questions: 6 mechanics + Q09 unit conversion fix
- ✅ Metamorphic Tests: 3 个（projectile, newton, incline）
- ✅ Edge Cases: mass=0, mass<0, g=0, NaN check

## 待完成（UI 阶段）

- ⬜ Lab UI: Mechanics Lab Templates + MechanicsRenderer
- ⬜ Question UI: auto-adapt mechanics（当前 QuestionWorkspace 已可处理 mechanics pipeline，但 Canvas 仍为 magnetic renderer）
- ⬜ Mechanics Scene Commands（SetBodyMass, SetInitialPosition, SetLaunchAngle 等）
- ⬜ Browser smoke E2E
- ⬜ Screenshots
- ⬜ Data Panel x-t/v-t/a-t charts
- ⬜ Home/Recent Spaces 更新
