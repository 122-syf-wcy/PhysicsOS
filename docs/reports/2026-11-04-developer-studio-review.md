# Final independent review — developer surfaces polish

Date: 2026-11-04. Reviewed range: `fb56e23..32adcc1`, branch `codex/experiment-contribution`. Also reviewed the narrow packaging approach in `runtime-manifest.mjs` and `compare-runtime.py` in this directory against the runtime Dockerfile and recorded running-image baseline.

This was a read-only review of source, diff, requirements, release/progress records, acceptance-script assertions, and all eight existing studio screenshots. No builds, tests, network/server requests, checkout changes, or additional reviewer delegation were performed. The only written artifact is this report. `git diff --check fb56e23..32adcc1` was clean.

## Strengths

- The Markdown chooser is a native `button` calling the retained file input, with `disabled={busy}` applied to both elements (`AdminPromptTab.tsx:315–330`). The new explicit textarea label and focusable preview improve keyboard/screen-reader access. The recorded browser run exercises Enter on the actual chooser; acceptance still imports and compares real downloaded content.
- Save, publish, history selection, and activation conditions remain unchanged. The new current-version block, dirty/saved badge, preview label, and history marker expose the existing distinctions without altering the API contract. The contribution rollback expression is equivalent for its declared boolean/object inputs.
- Admin styles are CSS-module scoped; the few global selectors only select the theme ancestor. No shared admin stylesheet or experiment renderer was changed. Public documentation styles remain confined to the separate static document application.
- The admin container query switches the editor/history layouts using available panel width. Versions, notes, digests, and previews have wrapping rules; the existing upload filename ellipsis and narrow-screen file-action layout remain intact. The 390px screenshots show clean header/resource-card layouts, and the recorded overflow assertions cover the mounted page/surface. Desktop and dark screenshots show readable text and unobscured controls in the visible regions.
- Decorative artwork keeps empty alt text, declared dimensions, and adjacent accessible text. WebP assets are small and reused across the relevant surfaces. Provenance and prompts are retained separately from credentials.
- Packaging starts from the actual healthy production image, compares file content/mode/link targets, refreshes the final web/UI subtrees, and preserves older hashed assets. The manifest roots match the relevant Dockerfile runtime paths; skipping `.git`, `.env*`, and test/cache directories avoids copying the obvious build-only state. The recorded repair of the three temporary dependency links addresses concrete problems before image creation.

## Issues

### Critical

None found in the reviewed scope.

### Important

None found in the reviewed scope.

### Minor

1. **The link fence proves direct path containment, not the assembled image's dependency graph.**
   - File: `.superpowers/sdd/2026-11-04-developer-surfaces-polish/compare-runtime.py:15–17`.
   - Trigger: a changed link points to a missing location under `/app`, or to another link whose final target is absent/outside `/app` in the image. `Path.resolve()` runs against the comparison process's filesystem, with non-strict existence handling, rather than the merged base-plus-delta filesystem; the `/app/` prefix assertion can therefore pass. It also only examines changed links.
   - Impact: the comparison output alone must not be described as proof that required workspace links resolve. A dependency used only on a later route could still fail even if the application's bootstrap is healthy. No such remaining broken link is demonstrated by the supplied evidence, so this is a validator limitation rather than a release blocker found in the current image.
   - Recommendation: record an in-image resolution/existence check for required workspace/runtime links alongside the candidate smoke checks, or resolve the complete merged manifest graph with cycle/missing-target detection. Keep intentional optional links distinguishable from required runtime links.

## Validation and limits

The release report records 14 affected client tests, types/lint/bundles, 7 public documentation browser tests, the real prompt workflow, the student upload/admin review workflow, and the studio keyboard/overflow checks as passing. The assertions reviewed exercise actual chooser/import, dirty-state publication gating, copy/download identity, and retained current-version behavior; the one changed acceptance selector follows the new visible control without weakening those assertions. These are recorded executor results, not tests rerun by this reviewer.

The eight studio screenshots are viewport captures, not full-page captures. They provide direct visual evidence for the visible header/editor/resource areas, while the lower import/publish/history/review areas are assessed from their code and the existing interaction evidence. CSS handling supports long values, but no screenshot claim is made for every maximum-length value or every intermediate viewport.

## Declined to judge

- Earlier V2 upload/prompt implementation, authorization rules, sandbox protocol, and database business logic: explicitly excluded from this review; those changes were already independently reviewed and tested.
- The upstream default Vitest startup failure: outside the UI diff and documented as test-environment externalization before test collection; the existing native web test configuration was the verified path.
- Candidate image/PostgreSQL-clone completion, final dependency resolution, deployment switch, GitHub push, HTTPS smoke, and recovery execution: still in progress when this review was written, and server/network actions were prohibited for this reviewer. They remain executor release gates.
- A clean-from-scratch rebuild's byte-for-byte reproducibility and exhaustive unrelated runtime behavior: the authorized release approach is a delta over the reconciled running image, and the review was limited to that packaging approach rather than a new whole-system audit.

## Assessment

**Ready to merge: Yes, for `fb56e23..32adcc1`.** The UI wave follows the approved design and preserves the interaction contracts; no Critical or Important regression was found. The packaging approach is reasonable for the reconciled baseline, with the link-check limitation above. Production completion should be claimed only after the already-planned candidate and deployment verification records are complete; this review is not evidence that those operations have finished.
