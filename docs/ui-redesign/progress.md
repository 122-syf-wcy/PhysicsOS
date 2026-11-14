# UI redesign progress — 2026-11-14

## Latest mascot iteration after the notes below

User removed the kitten, requested more silver jewelry and explicitly requested varied clothing and poses. Generated and visually reviewed five no-cat transparent PNGs using built-in image_gen: silver-greeting, thinking (ivory blouse/vest/trousers seated), searching (blue-grey tunic/red apron crouched with magnifier), explaining (cranberry jacket/long skirt teaching), complete (teal blouse/blue skirt joyful clap/jump). Saved project-bound originals and a ZIP under the original workspace design-refs/guizhou-ip-2026-11-14, with copies under this clone's public/physicsos/mascot/guizhou/silver-variants-v1. All five alpha channels verified. Culture sources and prompt set saved alongside. These are static assets, not animations or legally cleared heritage endorsements. Runtime mapping and production remain unchanged; original full UI task remains unfinished and untested.

## Current user direction

- Resume baocode plan aa752fa9-c56c-47e9-80fc-b03f9aabfb64; implement the entire approved UI and deploy only after acceptance. Git commit/push/main integration already authorized in the recovered plan.
- Prefer existing assets; use built-in image generation only when needed, not the third-party API from the old conversation.
- User requested Guizhou heritage cultural IP, initially chose a new mascot, then rejected concept 01 and explicitly chose the existing female system mascot as the identity reference.
- Latest generated version preserves the existing curly-haired girl, watercolor illustration and tabby cat, with an original contemporary Miao clothing-inspired outfit. Image references were the repository's existing wave/think assets. Prompt: mascot-girl-prompt-v2.txt. This is a proposed wardrobe variant, not an authentic traditional costume reconstruction or a legally cleared/officially endorsed heritage collaboration.
- Source PNG is saved in public/physicsos/mascot/guizhou/mascot-girl-wave-master-v1.png; no runtime mascot replacement yet. New draft needs the user's visual feedback and consistent think/search variants before full integration. Old assets remain.
- Earlier mascot-direction.md and mascot-prompt-v1.txt describe the REJECTED new creature concept. Retain for history; do not implement that direction.

## Source work

- Independent normal clone: /Users/dongsiwei/Desktop/PhysicsOS-UI, branch codex/ui-redesign-complete, base main 6f2f0dcd.
- Preserved 6 UI files from prior worktree, including website redesign.css, AdminPrimitives/AdminWorkspace and NoticeBoard. These remain unverified draft changes.
- Draft product shell: explicit data-physicsos-ui flag, full-width main with floating short rail, header settings/account, modal workspace/history, and retained global panel menu. Homepage simplified around the real composer. No business services removed.
- 62-item implementation/role/entry matrix: coverage.json/coverage.md. All evidence remains pending; existing components do not count as validated implementations.
- Asset audit: assets.json/assets.md. Existing 105 files about 2.6MB plus 71 SVG icons; keep stable duplicate URLs. Added new generated girl image separately in response to user direction.
- Upstream shell edits currently live ONLY inside this clone's vendor tree and still require review and overlay capture. Overlay file edits must be projected into vendor before capture to avoid overwriting them. Do not capture the original dirty workspace or old worktree.
- No commits, pushes, formal tests, candidate or production deployment completed in this continuation.

## Server findings

- /opt/physicsos checkout and remote main both 6f2f0dcd; actual production image revision label and published-source baseline still b50232a4. Production remains healthy; validation worker healthy.
- About 4.7GB free. Registered builder physicsos-deployment-builder-20261111 is absent. Other long-lived build images have different lockfiles; they cannot stand in for a validated current builder.
- Another docker build of physicsos-app:acceptance-6f2f0dcd was already running (PID 17709, log /tmp/direct-build.log). It was about 33 minutes old at inspection and compiling host declarations. Do not terminate it, prune active build cache, or start a conflicting full build. No production mutations performed.
- Continue source implementation while verifying ownership/progress and preparing a valid build path under existing release scripts. Preserve unknown candidates, data, image history and backups.
