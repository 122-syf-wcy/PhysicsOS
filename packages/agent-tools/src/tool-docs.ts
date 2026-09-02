/**
 * Model-facing names and descriptions of the physics tools.
 *
 * They live here, next to the handlers, so every harness binding (DeepSeek
 * Harness today, anything else tomorrow) presents the same contract to the model
 * and the contract tests can pin the wording. Descriptions are written for the
 * model, in the language the product speaks to students.
 */

import { EXPERIMENT_CATALOG } from './experiment-catalog.ts'
import { commandReferenceText } from './scene-commands.ts'

export const PHYSICS_TOOL_NAMES = [
  'physics_list_experiments',
  'physics_create_experiment',
  'physics_solve_question',
  'physics_describe_scene',
  'physics_scene_command',
  'physics_simulate',
  'physics_observe',
] as const

export type PhysicsToolName = (typeof PHYSICS_TOOL_NAMES)[number]

const catalogSummary = (): string =>
  EXPERIMENT_CATALOG.map((entry) => `${entry.id}（${entry.title}，${entry.domain}）`).join('、')

export const PHYSICS_TOOL_DOCS: Readonly<Record<PhysicsToolName, { readonly description: string }>> = {
  physics_list_experiments: {
    description:
      '列出 PhysicsOS 实验目录（id、领域、学段、标题、一句话说明）。当你想给学生开一个实验但不确定 id 时先调用它。目录固定为：'
      + catalogSummary()
      + '。',
  },
  physics_create_experiment: {
    description:
      '按目录 id 打开一个 PhysicsOS 实验，得到可继续操作的 sceneId，以及场景里所有对象的 id（改参数时要用）、可用的可观察量和该领域可用的 SceneCommand 类型。'
      + '实验的物理事实由 Scene Factory 给出，与实验室里学生看到的模板完全一致。',
  },
  physics_solve_question: {
    description:
      '把一道初高中物理题（中文题面）交给 PhysicsOS 题目运行时：确定性解析 → 语义校验 → 建场景 → 引擎求解 → 守恒校验。'
      + '返回已知量、待求量、逐步解答（每步的公式、结果与单位）、校验结果，以及题目对应场景的 sceneId（可再用 physics_scene_command 改条件、physics_simulate 重跑）。'
      + '解析失败时返回 status="rejected" 和原因，此时不要自行编数值答案——如实告诉学生哪里没看懂。'
      + '你自己不要做任何物理计算：所有数值必须引用本工具或 physics_simulate / physics_observe 的返回。',
  },
  physics_describe_scene: {
    description:
      '查看一个已打开场景的当前状态：标题、领域、修订号、时间轴、对象 id 列表、可观察量、以及可用命令类型。改参数前用它确认 id。',
  },
  physics_scene_command: {
    description:
      '对场景执行一条 SceneCommand（改物理条件）。命令会被场景运行时校验：单位不对、数值越界、命令不属于该子模型都会被拒绝并返回 ok=false 与原因，此时场景保持不变。'
      + '数量写成 {"value": 数值, "unit": "单位"}，矢量写成 {"x":…, "y":…, "unit": "单位"}。改完条件后调用 physics_simulate 拿到新结果。\n'
      + '命令参考：\n'
      + commandReferenceText(),
  },
  physics_simulate: {
    description:
      '用与该场景绑定的物理引擎对当前修订做一次完整模拟并做守恒校验。返回：引擎与领域、校验状态与每条检查、导出量（key / 数值 / 单位 / 公式）、事件（落地、离场、成像等）与采样区间。'
      + '这是所有数值结论的唯一来源。',
  },
  physics_observe: {
    description:
      '读取场景在某一时刻 t（秒）的引擎状态：每个对象的位置、速度与瞬时值，以及该时刻的导出量。用来回答"t = 2 s 时物体在哪里、速度多大"这类问题。',
  },
}
