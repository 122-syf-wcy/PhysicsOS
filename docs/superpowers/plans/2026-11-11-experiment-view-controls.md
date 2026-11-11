# Experiment View Controls Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 解决实验不能缩放调整、加入按钮遮挡和导航图标重复三项问题。

**Architecture:** 现有实验包拥有相机交互；宿主顶部操作区拥有加入动作；导航引用三张新生图资源。实验包发布遵循不可变版本及已有升级流程。

**Tech Stack:** JavaScript / Three.js、React / TypeScript / CSS、现有服务器 Docker 发布工具。

**Spec:** `docs/superpowers/specs/2026-11-11-experiment-view-controls-design.md`

## Global Constraints

- 构建、测试、候选及发布只在 107.151.246.59 Docker。
- 基于 main=c41c476，保留已有线上修复；不暴露密钥、不删除恢复点。
- 生图使用用户指定服务和 gpt-image-2.6-sunburst。

## Review Focus

- 播放帧/ResizeObserver 不覆盖用户缩放和平移。
- pointercancel/lostpointercapture/双指切换后不残留拖动。
- 窄屏按钮可达，图表无遮挡。
- 加入工作台使用当前参数和固定版本元数据。
- 旧场景升级明确且不覆盖历史包。

## Task 1: 实验相机

Files: `experiment-packages/lab-collection/src/renderer.js`, `public/index.html`, `public/assets/experiment.css`, 相邻浏览器测试。

- [ ] 用现有浏览器测试建立无缩放交互的失败证据。
- [ ] 实现缩放、平移、复位和手势清理；保持相机状态独立于物理状态。
- [ ] 服务器 Docker 验证真实相机变化、播放保持、触屏和小视口。

## Task 2: 加入按钮与导航

Files: `LabWorkspace.tsx`、`PhysicsWorkspace.tsx` / 共用顶部栏、`ConvexLensPage.tsx`、`SidebarNav.tsx`、对应样式、静态图标目录。

- [ ] 保留加入逻辑，将入口从 routeNotice 搬入顶部动作区。
- [ ] 生成三个独立图标，检查小尺寸并接入导航。
- [ ] 服务器运行相关宿主测试及浏览器布局/功能验证。

## Task 3: 集成发布

- [ ] 审查差异和测试证据。
- [ ] 核验空间，构建不可变实验新版及宿主候选，验证旧场景升级路径。
- [ ] 核对 main / checkout / image，备份后发布并做正式站验证。
- [ ] 写入实测记录，交付路径与使用方式。
