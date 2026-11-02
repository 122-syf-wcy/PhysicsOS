# 宿主与实验协议

用固定消息交换状态，实验文件不依赖主站内部代码。

## 视图区与平台分开运行

平台加载清单 entry 指定的 HTML 到隔离 iframe。父页面提供参数、记录、报告、作者；包内页面只创建三维实验视图区。生产会在独立资源域运行，不能依赖 parent.document、同源存储或平台 Cookie。

> **模板预览的身份**：独立预览器已实现参考握手和快照交互；它不是正式上传后台，也没有生产账号或引擎。不要自行写一个假 /upload 接口当成平台接入。

## 一次握手，一条专属通道

- 宿主为每次挂载生成随机 channel，并将精确 hostOrigin 与 channel 放入入口查询参数。channel 不是账号令牌。
- 实验向精确 hostOrigin 发送 experiment/ready，包含 protocolVersion: 1 和 channel。
- 宿主检查 event.source 为该 iframe、sandbox 不透明 origin、channel 与协议版本，创建 MessageChannel。
- 宿主只向这个 iframe 发送 experiment/connect 并转移一个端口；实验检查 event.source === parent、精确宿主 origin、channel 后接受。
- 由于 sandbox 使用不透明 origin，宿主这一次端口转移需 targetOrigin="*"；它只面向已绑定 iframe，不携带用户数据。后续状态通过 MessagePort，不能广播到 window。
- 关闭或重新加载时关闭端口，旧通道不能影响新实例。

## 消息与方向

| 消息 | 方向 | 用途 |
| --- | --- | --- |
| experiment/ready → experiment/connect → experiment/connected | 实验 ↔ 宿主 | 握手及端口确认 |
| experiment/snapshot | 宿主 → 实验 | 只读 revision、source、parameters、result |
| parameter/preview | 实验 → 宿主 | id/value，临时显示，不落库 |
| parameter/commit | 实验 → 宿主 | id/value，校验后提交一次 |
| parameter/cancel | 实验 → 宿主 | 取消当前预览 |

宿主必须限制参数 ID、数值范围、消息大小与频率；未知消息拒绝或忽略。实验必须验证快照类型与有限数值。作者、发布权限与学习记录不能由实验消息指定。

## 凸透镜开发快照示例

### 以 src/protocol.ts 为模板中的类型真值

```json
{
  "revision": 0,
  "source": "preview-fixture",
  "parameters": {
    "objectDistanceCm": 30,
    "focalLengthCm": 10,
    "screenDistanceCm": 15
  },
  "result": {
    "imageDistanceCm": 15,
    "imageHeightCm": -3,
    "imageKind": "real",
    "screenSharp": true
  }
}
```

示例坐标单位是 cm，已在字段名中说明；平台内部单位由正式适配器转换。source=preview-fixture 明确表示开发数据。只有平台引擎实际生成的结果才能标记 platform-engine；展示该字段不构成独立的物理验证证明。

## 平台接入需要完成的工作

上传与权限校验、资源隔离域、引擎适配器、审核预览、不可变发布与回滚、运行版本固定仍需主平台实现。贡献者只面向已文档化的文件与协议，不需要参与这些内部源码改动。
