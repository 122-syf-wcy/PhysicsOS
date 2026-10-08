# @physicsos/image-generation

Image-generation adapter for PhysicsOS design assets: a small provider contract
plus one OpenAI-compatible implementation (`SunburstImageProvider`, gateway
`https://image.haqiuhaqiu.xyz`, model `gpt-image-2.5-sunburst`).

```ts
interface ImageGenerationProvider {
  generate(input: {
    prompt: string
    size?: string
    purpose: 'ui-concept' | 'icon-concept' | 'experiment-cover' | 'share-card' | 'teacher-asset'
  }): Promise<GeneratedImage>
}
```

## What it is for — and what it is not

Generated images are **decoration, not physics**. Allowed: UI concepts, icon
concept sheets, experiment covers, teacher illustrations, share cards, Explore /
Challenge covers, documentation visuals. Forbidden: particle trajectories,
apparatus renders, force or field vectors, experimental data graphs, measurement
results, `PhysicsScene` representations, Verified Results.

AI images never enter the physics fact chain
(`PhysicsScene → Engine → Observation → SceneVisualModel → Renderer`). Nothing
here may be wired into a physics canvas.

Icons: the model produces concept sheets and shape exploration only. Final
product icons at 16/20/24px are re-drawn as SVG with `currentColor`, shared
stroke weight and radius, and optical alignment — never cropped from an AI PNG.

## Configuration (environment only)

| Variable                    | Default                        |
| --------------------------- | ------------------------------ |
| `PHYSICSOS_IMAGE_API_KEY`   | — (**required**, secret)       |
| `PHYSICSOS_IMAGE_API_BASE`  | `https://image.haqiuhaqiu.xyz` |
| `PHYSICSOS_IMAGE_API_MODEL` | `gpt-image-2.5-sunburst`       |

The key is a secret: it is read from the environment at call time and never
written to source, metadata, logs or errors. `.env` / `.env.*` are gitignored
(`.env.example` ships empty values only). An unset key throws
`MissingImageApiKeyError` — there is deliberately no placeholder fallback.

The older one-`S` name `PHYSICOS_IMAGE_API_KEY` (and the symmetric base/model
names) is still read as a **deprecation alias for one compatibility cycle**, and
warns once per process without printing any value. See
`docs/adr/0004-image-api-env-migration.md`.

## Usage

```ts
import { SunburstImageProvider } from '@physicsos/image-generation'

const image = await new SunburstImageProvider().generate({
  purpose: 'icon-concept',
  prompt: 'flat line-icon concept sheet …',
})
// image.bytes, image.width, image.height, image.model, image.requestedSize
```

`NodeJS.ProcessEnv` may be injected (`{ env }`) for tests; `size` overrides the
per-purpose default (a wide canvas for `ui-concept`/`experiment-cover`/
`share-card`, a square for `icon-concept`/`teacher-asset`).

## Secret-leak gate

```sh
pnpm -C packages/image-generation run scan:secrets             # scan the repo
pnpm -C packages/image-generation run scan:secrets:self-test   # prove the gate works
```

It scans every git-tracked file — source, docs, fixtures, snapshots,
design-asset manifests, generated reports — for `sk-` + 20 key characters and
for the literal values of the project's sensitive env vars (only those actually
set). Findings are redacted to a length; the value is never echoed. Unset
credential env vars simply add no needles, so the gate is safe to run in CI.

## Regenerating the concept assets

The two assets under
`overlays/harness/files/apps/web/design-assets/{icon-concept-sheet,lab-ui-concept}/`
were produced by this adapter. Each has a `manifest.json` recording the model,
endpoint, size, prompt and the exact prompt text that was sent, so a rebuild is
reproducible from the repository alone. The key comes from the environment —
never from the command line, never from a file in the repo:

```sh
set -a; . ~/.dsh/.env; set +a   # or: export PHYSICSOS_IMAGE_API_KEY=…

node --input-type=module -e '
import { mkdirSync, writeFileSync } from "node:fs"
import { SunburstImageProvider } from "./packages/image-generation/src/index.ts"

const out = "overlays/harness/files/apps/web/design-assets/icon-concept-sheet"
const image = await new SunburstImageProvider().generate({
  purpose: "icon-concept",
  // copy the prompt verbatim from the asset manifest.json
  prompt: process.env.CONCEPT_PROMPT ?? "",
})
mkdirSync(out, { recursive: true })
writeFileSync(`${out}/icon-concept-sheet.png`, image.bytes)
console.log(image.model, `${image.width}x${image.height}`)
'
```

Swap `purpose`/paths for `lab-ui-concept` (`ui-concept`) for the second sheet.
The generation step is deliberately _not_ wired into the build or the test
suite: it needs a credential and the network, and the tests here must stay
deterministic and offline.
