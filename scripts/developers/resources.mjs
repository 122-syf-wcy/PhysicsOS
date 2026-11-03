import { agentInstructions } from '../../overlays/harness/files/apps/web/public/physicsos/developers/standards.js'
import {
  documents,
  documentMarkdown,
} from '../../overlays/harness/files/apps/web/public/physicsos/developers/content.js'

import { z } from 'zod'
import {
  manifestV2Example,
  manifestV2Schema,
  parametersV2Document,
  parametersV2Schema,
  teachingV2Example,
  teachingV2Schema,
  casesV2Document,
  casesV2Schema,
  assetLicensesV2Example,
  assetLicensesV2Schema,
} from '../../overlays/harness/files/packages/physicsos/experiment-host/src/contract-v2.ts'
export const manifestExample = manifestV2Example
// Custom semantic refinements also run in the canonical validator, beyond JSON Schema.
export const manifestSchema = z.toJSONSchema(manifestV2Schema, { unrepresentable: 'any' })
const stringify = (value) => JSON.stringify(value, null, 2) + '\n'

export function downloadableResources(options = {}) {
  return new Map([
    ...documents.map((doc) => [doc.file, documentMarkdown(doc)]),
    ['AGENTS.md', agentInstructions('convex-lens', options)],
    ['experiment.schema.json', stringify(manifestSchema)],
    ['experiment.example.json', stringify(manifestExample)],
    ...[
      ['parameters', parametersV2Schema],
      ['teaching', teachingV2Schema],
      ['cases', casesV2Schema],
      ['asset-licenses', assetLicensesV2Schema],
    ].map(([name, schema]) => [
      `${name}.schema.json`,
      stringify(z.toJSONSchema(schema, { unrepresentable: 'any' })),
    ]),
  ])
}

export function styleKitFiles(options = {}) {
  return new Map([
    ...downloadableResources(options),
    [
      'README.md',
      `# PhysicsOS 代码风格工具包 v1.0

这是辅助代码风格工具包。需要预览、构建与 ZIP 打包，请下载独立实验模板 physicsos-experiment-template-v2.zip。

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
      `/** Style example only; the SDK contract is src/contract-wire.ts. */
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

export function templateMetadata() {
  return new Map(
    Object.entries({
      'experiment.json': manifestV2Example,
      'parameters.json': parametersV2Document,
      'teaching.json': teachingV2Example,
      'cases.json': casesV2Document,
      'ASSET-LICENSES.json': assetLicensesV2Example,
    }).map(([name, value]) => [name, stringify(value)]),
  )
}
