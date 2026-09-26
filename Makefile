SHELL := /bin/sh
.DEFAULT_GOAL := doctor

.PHONY: install doctor typecheck lint test test-web test-agent test-desktop acceptance build desktop-sidecar desktop-release desktop-config overlay-apply overlay-capture server-up server-logs server-ready clean

install: overlay-apply ## 安装根与 Harness 两个工作区的依赖
	pnpm install --frozen-lockfile && pnpm -C vendor/deepseek-harness install --frozen-lockfile --ignore-scripts

doctor: ## 检查开发环境、工具链、子模块、overlay 与本地 secret 文件
	node scripts/dev/doctor.mjs

typecheck: ## 运行 core、Web 与 host 的类型检查
	pnpm typecheck

lint: ## 运行全仓库 lint
	pnpm lint

test: ## 运行常规测试套件
	pnpm test

test-web: ## 只运行 PhysicsOS 客户端测试
	pnpm test:web

test-agent: ## 只运行 PhysicsOS host 插件测试
	pnpm test:agent

test-desktop: ## 运行桌面打包脚本与 sidecar 测试
	pnpm test:desktop

acceptance: ## 运行浏览器验收
	pnpm test:acceptance

build: ## 构建 core、Web、Agent 与所有 hosts
	pnpm build

desktop-sidecar: ## 打包桌面 sidecar 运行时
	pnpm desktop:sidecar

desktop-release: ## 构建桌面发布包
	pnpm desktop:release

desktop-config: ## 校验桌面开发配置
	pnpm desktop:config

overlay-apply: ## 把 overlays 源真值同步到 Harness 子模块
	git submodule update --init --recursive
	node scripts/overlay/harness-overlay.mjs apply

overlay-capture: ## 从 Harness 子模块回收 overlay 与上游补丁
	git submodule update --init --recursive
	node scripts/overlay/harness-overlay.mjs capture

server-up: ## 启动 Compose 服务
	docker compose up -d

server-logs: ## 跟随查看 app 服务日志
	docker compose logs -f --tail=200 app

server-ready: ## 检查本地 app readiness
	curl --fail --show-error --silent http://127.0.0.1:3080/readyz

clean: ## 删除构建与测试产物，保留依赖和 .env*
	@set -eu; \
	rm -rf dist build .turbo coverage playwright-report blob-report test-results; \
	find packages apps tests -path '*/node_modules' -prune -o -type d \
		\( -name dist -o -name build -o -name .turbo -o -name coverage \
		-o -name playwright-report -o -name blob-report -o -name test-results \) \
		-prune -exec rm -rf '{}' '+'; \
	find packages apps tests -path '*/node_modules' -prune -o -type f \
		-name '*.tsbuildinfo' -delete; \
	if [ -d vendor/deepseek-harness ]; then \
		find vendor/deepseek-harness -path '*/node_modules' -prune -o \
			-path '*/.git' -prune -o -type d \
			\( -name dist -o -name lib -o -name .turbo -o -name coverage \
			-o -name playwright-report -o -name blob-report -o -name test-results \) \
			-prune -exec rm -rf '{}' '+'; \
		find vendor/deepseek-harness -path '*/node_modules' -prune -o \
			-path '*/.git' -prune -o -type f -name '*.tsbuildinfo' -delete; \
	fi
