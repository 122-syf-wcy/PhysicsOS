# Canvas Usability Follow-up

User requested continued work, with autonomous design and direct deployment authorization retained.

Goal: preserve the first live apparatus implementation while making phone diagrams unobstructed, realistic multi-part layouts usable, and numeric edits trustworthy.

Constraints: actual server107.151.246.59 /opt/physicsos Docker is build/test/deploy authority; preserve newestmain/runningimage and secrets; snapshot before switching and retain rollback images.

- [x] Test then fix mobile construction readouts: PhysicsCanvas optionalshowReadout(defaulttrue); CanvasFrameStage measuresCSSwidth viaResizeObserver/clientWidth. Narrow(<480px) construction gets diagram region>=240px plus realreadings below, totalstage>=360px. Measurements remain fromsameframe and outsideSVG; wide overlays and otherlabs remain unchanged.
- [x] Test then fix numeric inputs, automatic three-column placement, and outward touchhit targets throughagentcanvas_recon. Preserveexplicitplacement, topology, source selection and bodydragging.
- [x] Run focused/integration tests, TypeScript, bundle andVite build on isolatedservercontainer. Review source changes independently.
- [ ] Build a delta overguardedactual39f7image; validate actualdesktop/phone operations includingclosed/parallelcircuit andreload.
- [ ] Recheckmain/server/image, makefreshpairedbackup, switch through robust16fault-tested script and verifyformal/readyz andimage.

Review focus: resizing betweenwide/phone must notduplicate orlosequantities; touchtargets must notobstructbodydrag; partiallyeditedfields must notchangephysicalfacts; automaticplacement must neverrewireexistingcomponents; authentication/read-onlyguard andpersistence remain intact.
