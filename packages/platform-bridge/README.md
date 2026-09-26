# @physicsos/platform-bridge

## Purpose

隔离浏览器 / 未来 Tauri 的平台能力。业务组件禁止出现 `window.__TAURI__`。

## Responsibilities

- `PlatformBridge` 契约
- `BrowserPlatformBridge`：浏览器文件 / 剪贴板 / 通知 / localStorage
- `TauriPlatformBridge`：原生设备指纹、应用数据目录、更新检查与安装

Tauri 桥只接受 shell 注入的 `window.__TAURI__.core.invoke` 或测试客户端，
普通浏览器里会以 `TAURI_UNAVAILABLE` 失败关闭。设备标识由 Rust 侧读取原始值、
加持久盐后哈希；更新检查与安装只接受精确匹配的候选版本，产物验签由
`tauri-plugin-updater` 使用编译进应用的公钥完成。

## Allowed Dependencies

`@physicsos/shared`

## Forbidden Dependencies

DeepSeek Harness、Physics Engine、React 业务页面。
