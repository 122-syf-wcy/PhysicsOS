# Guizhou-inspired PhysicsOS tutor — approved 2026-11-14

The user approved five no-cat variants of the existing curly-haired girl. Source PNGs remain here; only optimized responsive derivatives are public. The rejected creature concept and earlier girl-with-cat draft are not referenced by runtime code. `history/` preserves previous staged source files without publishing them.

| Runtime pose | Clothes/action | Intended presentation |
| --- | --- | --- |
| wave | Indigo skirt, silver combs, neck rings and wrist ornaments; greeting | Welcome |
| think | Ivory blouse, indigo vest and trousers; seated with notebook | Thinking |
| search | Blue-grey short tunic and red apron; crouched magnifier | Search |
| explain | Cranberry jacket and long indigo pleated skirt; pointing | Explain/tool work |
| complete | Teal jacket and layered blue skirt; joyful clap/jump | Completion |

`Mascot` retains `wave`, `think`, `search`, adds `explain`/`complete`, and accepts the readable aliases `thinking`/`searching`/`explaining`. Full figures should be used where their posture can be read; compact buttons use `variant="avatar"`. Accessible status text is supplied by the caller and must reflect real state. These assets are static illustrations; the optional reduced-motion-aware breathing treatment is not a progress indicator or simulation.

Exports use macOS ImageIO (`sips --resampleHeight HEIGHT -s format avif INPUT --out OUTPUT`), at heights 160/320/640, with PNG320 compatibility fallbacks. The AVIF alpha channels and actual widths are listed in `exports.json`; `srcset` width descriptors use those actual widths, not the export height. No visual redesign or compositing was performed during export.

Cultural references and generation prompt records are preserved in `culture-and-usage.md` and `prompts.json`. Contemporary illustrative silverwork is not a claim to reproduce a particular village's ceremonial costume, nor an official heritage endorsement. No original third-party artisan imagery was used in this iteration; the existing system girl's earlier rights chain remains the project's responsibility.
