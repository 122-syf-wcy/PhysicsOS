# Admin and content UI source review

Status: source candidate ready for integration and server validation. No browser, typecheck, lint or test pass is claimed here. Production is unchanged.

## Implemented source changes

- Shared administration shell: one top navigation row with icons, local section tabs, real tab/tabpanel associations and keyboard navigation. Narrow screens scroll navigation within its own row.
- Accounts: a dense real-user table with one selected account detail panel, collapsed account creation, busy guards, and the existing create/status/password/session actions. Server account and school scope remain authoritative.
- School requests: a real request table and selected approval panel, preserving waiting applicants, quick approval, advanced school/admin fields and rejection.
- Schools and audit: compact school/status table and searchable audit table; no sample rows. Raw audit details remain expandable.
- Feedback: distinct submit/history panels, accessible tab navigation, category selection, error/success states, real replies and truthful progress labels. The form remains open on the page with the reference's guidance column and centered submit button.
- Administrator feedback: a queue table plus selected reply panel; draft replies remain keyed by report ID.
- Official website management: table plus selected entry editor for testimonials/contributors; whole-draft persistence, ordering, visibility, URL validation, version conflicts and unpublished conversion are retained. The private inbox has a selected detail pane and retains server filtering/pagination, protected image URL checking and replies.
- Model pool: separate channel/policy sections without discarding form state; existing encryption, tail-only credential display, destructive confirmations and host APIs retained.
- Paper studio: centered identity and pipeline, template-derived level/subject summary, compact structure/scope/advanced form and side summary. Final papers have real title/subject filtering, wide rows, PDF preview and download, with answer and Word exports retained. Draft/review/bank/import workflows keep their existing services and data.
- Library: centered identity, full-width search above category/stage controls, chapter sheet and content sheet; real question detail with complete stem, knowledge labels, tutor action and return preserving the search query. No generated solution or diagram is invented.
- Usage: actual summary.daily data shown as one selected metric at a time using the shared Chart, hover readout and original raw table. The account view does not request administrator scope.
- Contribution: compact working header, shared confirmed mascot and accurate general workflow copy; the real uploader and review pipeline remain mounted.

## Main design references inspected

10 new paper, 13 final-paper revision, 16 feedback, 17 resources, 22 resource detail, 36 users revision, and 46 website testimonials; the complete contact sheet and source mapping also informed common views. Actual browser screenshots must still be compared with each recommended design after the server candidate exists.

## Intentional data/API limits to verify in acceptance

- User display name/role/school are read-only in the detail pane because AdminApi has no update-profile/role operation. Existing supported actions remain available; the page does not show a save control that cannot persist.
- Golden question data does not provide reviewed solutions, diagram assets or an explicit related-experiment mapping. The detail pane displays the complete real stem and related knowledge and opens the existing tutor action rather than copying the design's sample explanation or claiming a related experiment.
- Paper, moderation and contribution retain some pre-existing Chinese-only copy and existing interaction structures. Their business flows, retry paths and confirmation/focus behavior must be checked in the server/browser acceptance pass.
- The exported artwork remains separate from data visualizations; no illustrative statistics, feedback or questions are used as production records.

## Tests updated or added, not executed locally

- notice-board.client.spec.tsx: submit/history separation, keeping feedback API semantics.
- admin-notice.client.spec.tsx: selected-report table interaction.
- admin-model-pool.client.spec.tsx: policy section selection before editing.
- admin-shell.client.spec.tsx: top navigation ownership instead of removed side grouping.
- library-papers.client.spec.tsx: stage filter button and complete question detail/practice/return query preservation.
- usage-workspace.client.spec.tsx: single metric switching with raw data retained and no scope widening.

All existing permission, credential, website conflict and private-image assertions remain in place. Root must project source and run the relevant server Docker checks. A source-only whitespace check (`git diff --check` for these features/tests) passed before handoff.

## Integration notes

- Root owns locale integration. Initial additions are in /tmp/physicsos-content-locales.json and final-paper additions in /tmp/physicsos-content-final-locales.json.
- contribute.supported already existed; avoid duplicate object keys and update its old narrow support claim in place.
- UsageWorkspace relies on the lab agent's shared Chart options width, height and zeroBased in workspace-parts.tsx.
- No overlay capture, commit, push or deployment was performed by this agent.
