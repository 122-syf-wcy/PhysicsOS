# @deepseek-ai/dsh-mobile-host

PhysicsOS 第一方 Android API，挂在 `/physicsos/mobile/v1` 一个前缀上。

这个包不拥有业务规则，也不建新的存储域：设备授权、学习记录、班级作业、已核验题库
和平台公告分别由 `auth-host`、`learning-host`、`class-host`、`paper-host`、
`notice-host` 负责。`mobile-host` 只把它们组合成 Android 客户端使用的
`{data}` / `{error}` 封套，并保证：

- 身份只来自服务端解析的凭据，绝不读请求体里的用户字段；
- 业务失败映射为真实 HTTP 状态，未知异常一律 500，不会伪装成成功；
- 变更请求必须带 `Idempotency-Key`，重试不会重复写入；
- 未挂载的依赖返回 503，而不是静默给出空列表。

## 路由

| 方法 | 路径 | 归属 |
| --- | --- | --- |
| POST | `auth/login`、`auth/register`、`auth/login/2fa`、`auth/refresh`、`auth/logout` | auth-host |
| GET | `auth/schools`、`auth/me`、`auth/devices` | auth-host |
| DELETE | `auth/devices/:id`、`auth/account` | auth-host |
| PATCH / POST | `auth/profile`、`auth/password` | auth-host |
| GET / PUT | `learning/attempts`、`learning/scenes/:id` | learning-host |
| GET / PUT | `classes`、`classes/:id/assignments`、`classes/:id/assignments/:aid/submission`、`.../target` | class-host / paper-host |
| GET | `library/questions`、`library/sources`、`library/annotations` | paper-host |
| GET / POST | `notices/platform`、`notices/platform/ack`、`notices/announcements` | notice-host |
| POST / DELETE | `devices/push`、`devices/push/:id` | notice-host 的推送终端表 |
| GET | `account/export` | learning-host / class-host |
