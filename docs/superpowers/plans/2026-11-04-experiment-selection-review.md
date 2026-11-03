# Experiment selection and admin review

> Implement inline with focused parallel admin-entry work and one final review.

Goal: visible experiment selector and a real rendered review page in administration.
Spec: ../specs/2026-11-04-experiment-selection-review-design.md
Constraints: all76 registered experiments with new generic V3; backward-compatible lens V1/V2, SUPER_ADMIN approval, Docker server validation, preserve production data and prior release. User confirmed all existing experiments.

- [ ] Add target selector tests and review-only permission/filter tests; run RED.
- [ ] Implement catalog-based enabled/disabled targets, selected API dispatch, review-only mode and filtering; run GREEN.
- [ ] Add independent SUPER_ADMIN admin tab, shared renderer and entry tests.
- [ ] Validate actual student upload → admin review entry → rendered preview → approval → new experiment session, plus render-failure gate/mobile.
- [ ] Review, commit, build candidate from current live image, preserve recovery points, deploy, push GitHub and verify HTTPS.


All-experiment extension:
- [ ] Generate canonical76 profiles and configured portable V3 SDK ZIP/prompt with official reference renderer.
- [ ] Generalize secure backend package intake, per-target publication/rollback, admin-only cross-target review queue.
- [ ] Implement bounded V3 snapshot/intent bridge, exact experiment runtime preview and generic workspace approved renderer with pinning.
- [ ] Verify all76 manifests/profiles/runtime snapshots, legacy lens tests, cross-target isolation, actual preview/render-failure behavior and production rollout.
