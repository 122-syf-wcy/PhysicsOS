# 代码风格

明确到文件名、类型边界和 Promise，让人与 Agent 都有同一份依据。

## 一张表，约定日常代码

| 项目 | 统一约定 | 例子 / 说明 |
| --- | --- | --- |
| 语言 | TypeScript 严格模式 | unknown → 校验 → 具体类型；类型依赖使用 import type |
| 格式 | 2 空格 · 单引号 · 无分号 | 多行尾逗号；目标行宽 100；UTF-8 / LF / 末尾换行 |
| 新文件 | kebab-case.ts / .tsx | 例如 lens-renderer.ts、experiment-page.tsx |
| 类型 / 可选组件 | PascalCase | 例如 ExperimentSnapshot；基础包不依赖宿主 React |
| 函数 / 变量 | camelCase | 例如 updateScreen、imageDistanceMeters |
| 常量 | UPPER_SNAKE_CASE | 例如 MAX_PIXEL_RATIO |
| 样式 | 实验内样式 + Warm Lab token | 只作用于隔离视图区；平台控件由宿主统一提供 |
| 测试 | 行为优先，期望值独立 | 模板检查 + 协议校验 + 浏览器预览，不运行主仓库构建 |

## 新代码统一命名，旧代码保持稳定

### 推荐目录命名

```text
convex-lens/
  experiment-page.tsx
  experiment-page.module.css
  lens-renderer.ts
  lens-interaction.ts
  lens-assets.ts
  types.ts
  tests/
    lens-interaction.test.ts
```

> **文件内保持一致即可**：实验文件包是独立工程。统一采用 kebab-case、TypeScript 严格类型与具名导出；无需迁就或修改主站旧文件。基础模板是 Three.js + TypeScript，不依赖主站 React 实例。

## 让类型表达边界

### 先验证，再使用

```typescript
interface ScreenReading {
  readonly distanceMeters: number
  readonly isSharp: boolean
}

export function isScreenReading(value: unknown): value is ScreenReading {
  if (typeof value !== 'object' || value === null) return false
  if (!('distanceMeters' in value) || !('isSharp' in value)) return false

  return typeof value.distanceMeters === 'number'
    && Number.isFinite(value.distanceMeters)
    && typeof value.isSharp === 'boolean'
}
```

- Props 和可视快照只读；不通过类型断言把错误数据“变正确”。
- 非空断言、any、@ts-ignore 不能用来代替边界校验。
- 单位写进边界类型或变量名称：distanceMeters 与 distanceCm 不混用。
- 优先具名导出；功能相近的文件放在同一实验目录。

## 异步与副作用必须有归属

### 取消、错误和清理都有出口

```typescript
export async function loadTexture(
  url: string,
  signal: AbortSignal,
): Promise<Blob> {
  const response = await fetch(url, { signal })
  if (!response.ok) throw new Error('纹理加载失败，请重试。')
  return response.blob()
}
```

异步结果返回时检查实例是否仍存在。不要在渲染函数里启动请求，不吞掉错误后显示成功，不把整个页面订阅到每一帧。

## 提示词约束意图，工具约束结果

| 层级 | 负责检查 |
| --- | --- |
| AGENTS.md | 范围、架构边界、物理事实、资源清理、交付方式 |
| Prettier | 缩进、引号、分号、换行与尾逗号 |
| ESLint | 类型使用、未处理 Promise、危险写法 |
| TypeScript | 契约、参数与空值边界 |
| 测试与评审 | 行为正确性、物理真实性、性能和体验 |

实验模板自带 Prettier、ESLint、TypeScript 与文件命名检查。模板命令作用于自己的目录，不调用主站 pnpm 或 overlay 构建。平台审核还要检查行为、源码与编译产物是否对应，格式通过不等于审核通过。
