Addon String snippets for the `# WoW <version>.<build>` header reader (#63) and the checksum
check (#67).

- `gulthrak-fury.txt`: a real, unedited export (Gulthrak, Fury Warrior), a copy of
  `apps/server/bench/sets/gulthrak-fury.txt`. Its checksum `b6775177` is the addon's own, so it is
  the evidence for how the addon hashes. Never edit it.

The rest are hand-written, none recorded from the addon. Their `# WoW` lines were written from
#63's description, before any real export was here; the real line, in `gulthrak-fury.txt`, also
carries `, TOC 120100`. Do not treat them as evidence of what the addon exports.

- `wow-header-live.txt`: a header carrying the Live version of the test SimC Build (`12.1.0.69933`).
- `wow-header-ptr.txt`: a header carrying that build's PTR version (`12.1.5.69952`).
