# @deepseek-ai/dsh-account-sync-host

手机与网页共用同一份账号数据的独立扩展插件。它只发布一个服务：
`physicsosMobilePersonalExports`。

## 职责

- 为安卓客户端提供 `account.profile`、`account.sessions`、`learning.whiteboards`、
  `learning.usage` 四个导出区段。
- 每个区段在读取前后都重新校验账号实例（`physicsosAccountErasureAuth.accountResources`），
  管理员看不到别人的账本。
- 缺少持久 Session 能力时明确返回 503，不返回空列表冒充完整导出。

插件不发布也不要求账号注销能力，不复制学习、班级、题库或通知的业务规则。

## 启用

```text
account-sync-host
```

必须在 `auth-host`、`learning-host` 与持久 Session 后端之后挂载；依赖在每次调用时解析，
加载顺序不影响启动，只是调用会等到服务就绪。

## 与账号注销的关系

账号注销是独立、按需启用的扩展，不在本插件内。未安装注销扩展时，移动端发起注销会得到
明确的 503，账号与数据保持不变。
