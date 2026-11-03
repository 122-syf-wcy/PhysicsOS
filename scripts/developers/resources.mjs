import { agentInstructions } from '../../overlays/harness/files/apps/web/public/physicsos/developers/standards.js'
import {
  documents,
  documentMarkdown,
} from '../../overlays/harness/files/apps/web/public/physicsos/developers/content.js'

export const manifestExample = {
  schemaVersion: 1,
  experimentId: 'convex-lens',
  version: '1.0.0',
  protocolVersion: 1,
  packageType: 'browser-static',
  entry: 'dist/index.html',
  renderer: 'three',
  theme: 'physicsos-warm-lab-v1',
  engine: { id: 'optics', contractVersion: 1 },
  parameters: 'parameters.json',
  cover: 'dist/assets/cover.jpg',
  teaching: 'teaching.json',
  referenceCases: 'cases.json',
  assetLicenses: 'ASSET-LICENSES.json',
  license: 'Apache-2.0',
}

const relativePath = {
  type: 'string',
  minLength: 1,
  maxLength: 240,
  pattern: '^(?!/)(?!.*(?:^|/)\\.\\.(?:/|$))(?!.*\\\\)[a-zA-Z0-9_./-]+$',
}
export const manifestSchema = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  title: 'PhysicsOS experiment package — V1 convex-lens contract',
  type: 'object',
  additionalProperties: false,
  required: Object.keys(manifestExample),
  properties: {
    schemaVersion: { const: 1 },
    experimentId: { type: 'string', maxLength: 64, pattern: '^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$' },
    version: { type: 'string', pattern: '^(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)\\.(0|[1-9][0-9]*)$' },
    protocolVersion: { const: 1 },
    packageType: { const: 'browser-static' },
    entry: { const: 'dist/index.html' },
    parameters: relativePath,
    renderer: { const: 'three' },
    theme: { const: 'physicsos-warm-lab-v1' },
    engine: {
      type: 'object',
      additionalProperties: false,
      required: ['id', 'contractVersion'],
      properties: {
        id: { type: 'string', minLength: 1 },
        contractVersion: { type: 'integer', minimum: 1 },
      },
    },
    cover: relativePath,
    teaching: relativePath,
    referenceCases: relativePath,
    assetLicenses: relativePath,
    license: { type: 'string', minLength: 1 },
  },
}

const stringify = (value) => JSON.stringify(value, null, 2) + '\n'

export function downloadableResources() {
  return new Map([
    ...documents.map((doc) => [doc.file, documentMarkdown(doc)]),
    ['AGENTS.md', agentInstructions()],
    ['experiment.schema.json', stringify(manifestSchema)],
    ['experiment.example.json', stringify(manifestExample)],
  ])
}

export function styleKitFiles() {
  return new Map([
    ...downloadableResources(),
    [
      'README.md',
      `# PhysicsOS 代码风格工具包 v1.0

这是辅助代码风格工具包。需要预览、构建与 ZIP 打包，请下载独立实验模板 physicsos-experiment-template-v1.zip。

## 开始

需要 Node.js >=24.7。首次安装需联网：

\`\`\`sh
npm install
npm run format:write
npm run check
\`\`\`

依赖版本固定；第一次安装生成 package-lock.json，请保留它。之后使用 npm ci。

check 执行 Prettier、源码文件命名、ESLint 与 TypeScript，不代替物理行为测试和浏览器验收。
将实验代码放在 src/experiments/<experiment-id>/，将 AGENTS.md 复制到该目录。
类型示例 lens-types.ts 只演示风格，不是公共平台契约。

## 贡献方式

贡献者独立制作实验文件，在对应实验页上传 ZIP，后台审核通过后自动同步。无需克隆 PhysicsOS 或修改主站源码。
本工具包只做风格检查。凸透镜已接通独立实验模板、文件上传、管理员审核与自动展示；其他实验逐步适配，不需要克隆主仓库。

## 文件

AGENTS.md：可直接交给开发助手的约束。
CODE_STYLE.md：命名、格式、类型和架构约定。
其他 Markdown：三维、物理、视觉、作者和投稿规范。
experiment.schema.json / experiment.example.json：候选格式，不代表审核通过。

来自 PhysicsOS；自有代码和文档遵循 Apache-2.0。第三方依赖各自遵循其许可证。
`,
    ],
    [
      'package.json',
      stringify({
        name: 'physicsos-code-style-kit',
        version: '1.0.0',
        private: true,
        type: 'module',
        license: 'Apache-2.0',
        engines: { node: '>=24.7.0' },
        scripts: {
          format: 'prettier --check src eslint.config.mjs prettier.config.mjs',
          'format:write': 'prettier --write src eslint.config.mjs prettier.config.mjs',
          lint: 'eslint src',
          typecheck: 'tsc --noEmit',
          'check:names': 'node scripts/check-names.mjs',
          check: 'npm run format && npm run check:names && npm run lint && npm run typecheck',
        },
        devDependencies: {
          '@eslint/js': '10.0.1',
          eslint: '10.8.1',
          prettier: '3.9.6',
          typescript: '6.0.3',
          'typescript-eslint': '8.67.0',
        },
      }),
    ],
    [
      '.editorconfig',
      'root = true\n\n[*]\ncharset = utf-8\nend_of_line = lf\nindent_style = space\nindent_size = 2\ninsert_final_newline = true\ntrim_trailing_whitespace = true\n\n[*.md]\ntrim_trailing_whitespace = false\n',
    ],
    ['.gitignore', 'node_modules/\ndist/\nrelease/\n*.tsbuildinfo\n.env\n.env.*\n'],
    [
      'prettier.config.mjs',
      `export default {
  semi: false,
  singleQuote: true,
  trailingComma: 'all',
  printWidth: 100,
  tabWidth: 2,
  endOfLine: 'lf',
}
`,
    ],
    [
      'eslint.config.mjs',
      `import js from '@eslint/js'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-non-null-assertion': 'error',
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
      '@typescript-eslint/explicit-function-return-type': 'error',
      '@typescript-eslint/ban-ts-comment': [
        'error',
        { 'ts-ignore': true, 'ts-nocheck': true, 'ts-expect-error': 'allow-with-description' },
      ],
      '@typescript-eslint/naming-convention': [
        'error',
        { selector: 'typeLike', format: ['PascalCase'] },
        { selector: 'function', format: ['camelCase', 'PascalCase'] },
        { selector: 'variable', format: ['camelCase', 'PascalCase', 'UPPER_CASE'] },
      ],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
)
`,
    ],
    [
      'tsconfig.json',
      stringify({
        compilerOptions: {
          target: 'ES2022',
          module: 'ESNext',
          moduleResolution: 'Bundler',
          lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          strict: true,
          noUncheckedIndexedAccess: true,
          exactOptionalPropertyTypes: true,
          noImplicitOverride: true,
          noFallthroughCasesInSwitch: true,
          allowImportingTsExtensions: true,
          verbatimModuleSyntax: true,
          noEmit: true,
          skipLibCheck: true,
          jsx: 'react-jsx',
        },
        include: ['src'],
      }),
    ],
    [
      'src/experiments/convex-lens/lens-types.ts',
      `/** Style example only; the public experiment SDK has not been released. */
export interface LensFrame {
  readonly objectDistanceMeters: number
  readonly imageDistanceMeters: number | null
  readonly imageKind: 'real' | 'virtual' | 'none'
}

/** Presentation state is separate from engine-owned physical facts. */
export interface LensViewState {
  readonly selectedObjectId: string | null
  readonly showRays: boolean
}
`,
    ],
    [
      'scripts/check-names.mjs',
      `import { readdir } from 'node:fs/promises'
import { join } from 'node:path'

const errors = []
const directoryPattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/
const filePattern = /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*(?:\\.test|\\.spec|\\.client\\.spec)?\\.tsx?$|^[a-z][a-z0-9]*(?:-[a-z0-9]+)*\\.module\\.css$/
async function walk(directory) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isSymbolicLink()) { errors.push(path + ': symlinks are not source directories'); continue }
    if (entry.isDirectory()) {
      if (!directoryPattern.test(entry.name)) errors.push(path)
      await walk(path)
    } else if (/\\.(tsx?|css)$/.test(entry.name) && !filePattern.test(entry.name)) {
      errors.push(path)
    }
  }
}
await walk('src')
if (errors.length > 0) {
  console.error('Use kebab-case source paths:\\n' + errors.join('\\n'))
  process.exitCode = 1
} else console.log('Source names passed')
`,
    ],
  ])
}
