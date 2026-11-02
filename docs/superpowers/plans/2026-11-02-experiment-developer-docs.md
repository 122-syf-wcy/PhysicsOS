# Experiment Developer Documentation Implementation Plan

User authorized building the developer documentation page; code consistency and copyable AGENTS.md are the primary goal. Preserve chosen independent routes, 3D-only experiment experience, warm natural lab style, latest approved version as default, author/GitHub attribution.

1. Build public static documentation under overlay apps/web/public/physicsos/developers. Sidebar, search, hash navigation, mobile menu, accessible code copying and downloadable resources. No runtime dependencies or remote fonts.
2. Author one content source for onboarding, code style, structure, runtime boundary, 3D lifecycle, visual standard, manifest draft, review/author policies, and AGENTS prompt. Copy and download derive from the same source. Clearly distinguish available docs/tooling from planned SDK/upload/review service.
3. Ship working code-style kit (strict TypeScript, formatter, ESLint and filename checker) with versioned rules. The kit is tooling, not a published experiment SDK. Generate downloadable Markdown and ZIP from the content source using Node stdlib; no embedded secrets or deployment configuration.
4. Generate and verify resources in isolated server Docker. Browser checks: navigation/search/back/unknown page, exact clipboard and downloads, scoped prompt injection validation, mobile 390px, no overflow or page errors; verify kit commands and malformed file naming. One final review, screenshot and preview delivery.

Decisions: new experiment files kebab-case per engineering standards; PascalCase component exports; two spaces, no semicolons, single quotes, trailing commas, 100-column formatting target. In-repo Web lint uses existing Harness oxlint (140-column ceiling); standalone kit uses ESLint, not a replacement of repository configuration. No production deployment without a completed candidate review.

Progress: content, portal, downloads, tool kit and browser acceptance implemented. Three unit tests pass; 13 downloads / 23-file ZIP verified byte-for-byte. Kit format/names/lint/typecheck passed with the exact declared dependency versions already present in the isolated server container. Invalid filename was rejected. Independent review found mobile hidden-nav focus, text contrast and TOC tracking issues; all fixed, then the acceptance suite passed.

User steering: use production website mark and IP character with image generation. Production 128/32 PNG marks reused byte-for-byte; imagegen edit using existing mascot reference and user-requested gpt-image-2.5-sunburst produced the developer illustration. Final prompt and public provenance included, secrets omitted.
