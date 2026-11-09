# Canvas State Consistency

User requested continued autonomous improvements and direct deployment, retaining no-question authorization.

- [x] Testthenfix finite rejected input: privatepanel edits report boolean settlement; invalidschema rejected viaexistingparseCircuitDraft; NumberField restores latestcommittedvalue onfailure and localalert is visible. Canvas wrapper distinguishesINVALID_DRAFT/WORKBENCH_EDIT_REJECTED from validunsolveddrafts. Acceptedno-op clears oldrejectiondiagnostics withoutphysicalrevision.
- [x] Testthenfix historyselection: filter surviving circuitcomponentIDs beforeinstalling restoredruntime; preserve onundo/redo, clear removedIDs, restoreoldhighlight onfailedhistory.
- [x] Testthenfix wirelifecycle: begin/complete onlyconstructmode; disablingrendererchannel clears localpointergesture once, so stableeditor canre-enter. Keep named/expandedtouch, bodydrag, sharedinstance/displayownership.
- [x] ServerDocker focused/regressiontests, typecheck,bundle; independentreview. Only source/Gitintegration locally.
- [x] Deltaimage overexactlivec165; own scratchspace cleanup ifneeded withoutpruningimages/backups; isolatedbrowser verificationthenfreshpairedrecovery/guardedswitchandformalready200.

Reviewfocus: invalidparams mustnotdisplayascommitted; valid0V/unchangedvalues/unfinishedtopology accepted; overlappingasyncfieldrequests mustnotrestoreanoldervalue; undoremovedpart clearsselection; queuedwireaction afterexit cannotre-enter; retaincurrentmain/runtimefeatures,secretsandrollbackdata.
