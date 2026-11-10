# 学生反馈优化实施

Spec: docs/superpowers/specs/2026-11-10-student-learning-feedback-design.md

用户已委托自主选择、无需再次询问并部署；继续使用同一隔离 worktree，分支 codex/student-learning-feedback，基线 bc9d6fe / 正式93305。

- [ ] 项目及会话：账号工作区选择 RED，章节项目与对话 UI、重命名、加入、画布关联，权限与持久化回归。
- [ ] 入口及收纳：最近实验/历史折叠，首页两学习路径，现有实验入口保持。
- [ ] iPad：触屏移动/编辑模式、缩放按钮与把手、尺寸设置、响应式读数和器材注释，触控及锁定回归。
- [ ] 拍题：图片 MIME / HEIC 正常化和上传错误恢复；代理容量对齐；图片单独发送、文字+图片、失败后草稿保留测试。
- [ ] 搜索及教学：公开检索工具与引用、隐私/URL/失败边界，学习 persona 的可靠讲解及逐步实验说明。
- [ ] 服务器集中回归、TypeScript和bundle、真实桌面/iPad浏览器；核对新 main/检出/镜像；候选文件一致性、配套备份、切换、HTTPS入口及回滚保护。

并行协作因当前会话 agent thread limit 无法再调度；独立读操作并行，修改和服务器测试顺序执行。
