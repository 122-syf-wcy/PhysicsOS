import { Config } from '@remotion/cli/config'

Config.setVideoImageFormat('jpeg')
Config.setJpegQuality(92)
Config.setCodec('h264')
Config.setCrf(18)
Config.setOverwriteOutput(true)
// remotion.media 的 Chrome 下载在本机网络不可达，复用 Playwright 已装的 headless shell
Config.setBrowserExecutable(process.env.REMOTION_BROWSER ?? '/Users/dongsiwei/Library/Caches/ms-playwright/chromium_headless_shell-1234/chrome-headless-shell-mac-arm64/chrome-headless-shell')
