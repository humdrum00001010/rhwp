# Hancom Line Layout Findings

This document separates verified behavior from unknown implementation details.
It must not be used to justify an rhwp layout heuristic.

## Verified Descriptor Semantics

The source fixture is `TJ5:WRAP `, followed by U+AC00 units and terminal
U+000D. The table-cell available width is `38072`.

| Source length | U+AC00 count | Emitted source intervals |
| ---: | ---: | --- |
| 36 | 26 | `[0,36]` |
| 37 | 27 | `[0,37]` |
| 38 | 28 | `[0,38]` |
| 39 | 29 | `[0,39]` |
| 40 | 30 | `[0,9] [9,40]` |
| 41 | 31 | `[0,9] [9,41]` |
| 42 | 32 | `[0,9] [9,42]` |
| 43 | 33 | `[0,9] [9,43]` |
| 44 | 34 | `[0,9] [9,44]` |
| 45 | 35 | `[0,9] [9,43] [43,45]` |
| 46 | 36 | `[0,9] [9,43] [43,46]` |
| 47 | 37 | `[0,9] [9,43] [43,47]` |
| 48 | 38 | `[0,9] [9,43] [43,48]` |

Deletion reproduced every insertion state in reverse. In particular:

```text
40 -> 39: [0,9] [9,40] -> [0,39]
45 -> 44: [0,9] [9,43] [43,45] -> [0,9] [9,44]
```

The final deletion restored source length 36 as `[0,36]`.

## Known Constraints

For the captured font and style, one U+AC00 unit has nominal advance `1100`:

```text
34 * 1100 = 37400 <= 38072
35 * 1100 = 38500 > 38072
```

This explains the second wrap threshold in this fixture. It does not define
Hancom's general horizontal advance function.

At source length 40, Hancom changes from `[0,39]` to `[0,9] [9,40]`. It does
not retain the longest fitting prefix on the first line. The source-space
boundary at position 9 therefore participates in endpoint selection with a
different status from an arbitrary internal Hangul boundary.

## Formal Boundary

Let `A_m(i,j)` be Hancom's effective advance for source interval `[i,j)` in
flow frame `F_m`, and let `B_m(i,j)` be its break admissibility or priority.

```text
C(i,m) = { j | i < j <= n, A_m(i,j) <= W_m, B_m(i,j) < infinity }
```

The captured implementation decomposes endpoint selection into a specialized
candidate selector `Q_m` and wrapper finalization `R_m`:

```text
b_{k+1} = R_m(b_k, overflow_k, Q_m, state_k)
```

For hyphenation mode, with candidate offsets `h_r` emitted in Hancom order:

```text
c_r = segment_origin + h_r + 1
Q_m = first c_r such that P_m(c_r) + M(c_r) <= W_m
```

Both an accepted sequence (`15`, then `13`) and no-candidate result (`-1`) are
captured. `R_m` is known to preserve `Q_m` in the accepted table case and to
override the specialized selector in the keep-word case. Its complete
protected-object, control, and page-transition predicates remain to be mapped.

`HwpApp.dll+0x189ab5` emits descriptors after `R_m`; it remains the output
oracle and is not used to infer candidate ordering.

## Edit Invariant

For document state `D`, style state `S`, frame sequence `F`, and canonical
Hancom layout `Lambda`:

```text
E^-1(E(D)) = D
    =>
Lambda(E^-1(E(D)), S, F) = Lambda(D, S, F)
```

This invariant is verified for the captured table-cell sequence. It contains
no stored/imported/generated geometry mode.

## Research Result

The two required internal code paths are identified:

1. The function or loop that computes effective horizontal advance for a
   candidate source interval.
2. The function or loop that classifies break candidates and selects the final
   source endpoint.

The preserved evidence contains executable addresses relative to module bases,
decompiled control flow, live inputs and outputs, reversible edits, a
no-candidate hyphenation run, and accepted candidate enumeration in a table
flow frame. The complete wrapper predicates for protected objects, controls,
and page transitions are separate extension work. rhwp must not replace them
with overflow guards, provenance flags, or longest-fit rules.

## Binary Code Map

### Paragraph flow-directive decoder

The routine at `HwpApp.dll+0x2d9210` is best labeled
`ResolveParagraphFlowDirective`. This is an inferred semantic label, not a
recovered original symbol. Its complete decoder establishes that it is not a
page-break-only query.

The input byte at paragraph offset `0x25` uses the HWP paragraph-header break
bits already represented by rhwp:

```text
0x01  section break
0x02  multicolumn break
0x04  page break
0x08  column break
```

The native precedence and internal bit-vector construction are:

```text
raw & 0x01 -> 0x100                    section
raw & 0x02 -> 0x800 | (raw&0x04?0x200:0) multicolumn, optionally page
raw & 0x08 -> 0x400                    column
raw & 0x04 -> 0x200                    page
paragraph style page-break-before -> 0x200
```

The resolver then applies context masks. One capability query clears the
`0x100|0x200` page/section axis when unavailable. A second capability query
clears the `0x400|0x800` column/multicolumn axis when unavailable. A plain
`0x400` column directive is additionally cleared when `columnIndex + 1 >=
columnCount`.

Its second caller at `HwpApp.dll+0x2d7c41` dispatches the normalized vector:

```text
0x100       -> section family
0x800       -> column-family branch
0xA00       -> page-family branch
0x400       -> column-family branch
0x200       -> page-family branch
0x82        -> terminal/default-owner branch
otherwise   -> automatic branch
```

The controlled GUI captures independently verified `0x200` for Ctrl+Enter and
`0x400` for Ctrl+Shift+Enter. Static decoding supplies the section,
multicolumn, normalization, and dispatch relations; it does not by itself
define the geometry produced inside each transition family.

### Native cursor predecessor

The routine at `HwpApp.dll+0x590d00` is best labeled
`MeasureBackwardCursorStep`. It receives a source offset and address-state
byte, reads the preceding source units through the native accessor, and
returns the number of units to move backward. Its script-range branches group
Korean/Jamo and control ranges, so endpoint resolution cannot be modeled as
integer `i - 1`. Together with the endpoint output pair `(offset,state)`, this
establishes the native cursor domain used by the canonical model.

The formatter is `CHwpFormatter` (`vftable` at `0x1076c934`). The horizontal
layout path in the analyzed `HwpApp.dll` is:

```text
FUN_101df1f0
  while (!(formatter->flags_0xdc & 1)) {
    FUN_101dde10(per_source_advance);
    FUN_101deaa0();
  }
```

`FUN_101df690` consumes the formatter result and creates the 0x3c-byte line
records. It copies interval pairs from `formatter+0x140`, marks the first and
last records with `0x20000` and `0x40000`, and writes the source interval and
available width. It is downstream of line selection.

### Horizontal advance

The normal-text width cache is populated by this chain:

```text
FUN_101d1910
  -> FUN_101d1c10
    -> FUN_101e3250
      -> FUN_101cfe90
```

`FUN_101cfe90` calls the active drawing backend's virtual method at vtable
offset `0x150` with the UTF-16 run, run length, and output array. The concrete
backend implementation is
`CHncDrawContext::GetTextExtentExPointW` at `HncBaseDraw.dll+0x62060`. Its
static pipeline is:

```text
CHncDrawContext::GetTextExtentExPointW
  -> FUN_1004df20
    -> FUN_10056520   script/language/font-fallback segmentation
    -> FUN_100568a0   per-segment font selection
      -> FUN_1005c6f0 modern glyph and Hangul advance calculation
      -> FUN_10057f50 legacy HChar advance calculation
    -> FUN_1004e2b0   cumulative dx, fit count, SIZE, rotation transform
```

`FUN_1005c6f0` handles Hangul syllables U+AC00..U+D7A3, Jamo composition and
fallback, indexed glyph widths, font ratio scaling, and per-code-unit output.
`FUN_10057f50` performs the corresponding legacy conversion and scaling path.
`FUN_1004e2b0` turns individual values into the cumulative `dx` contract.

Back in `HwpApp.dll`, `FUN_101cfe90` calls `FUN_101cfc10` for each source
position. That function applies spaces, Unicode categories, zero-width space,
character ratio, character spacing, and Korean/Latin/number pair adjustments
before storing the final per-position values. Live cumulative output records
for the target run are given below.

`FUN_101dde10` reads those values from the cache at `formatter+0x84`, then
applies the remaining paragraph semantics before accumulating the value:

```text
glyph advance
+ FUN_101ddd00 boundary adjustment
+ character/language spacing
+ grid or fixed-pitch quantization
+ control/object advance when present
```

The result is accumulated into `formatter+0xc8` and copied into the
per-source-position array used by break selection. Therefore rhwp's canonical
advance cannot be represented as `font.glyph_width(codepoint)` alone.

### Break selection

`FUN_101dde10` compares the accumulated next position against the current
horizontal interval. On overflow it sets bit 0 of `formatter+0xdc` and calls:

```text
FUN_101dd900
  -> FUN_101dd070
```

`FUN_101dd900` handles protected/object boundaries and delegates candidate
selection to `FUN_101dd070`. `FUN_101dd070` performs all of the following:

1. scans source positions around the overflow point;
2. recognizes spaces, U+3000, U+2000..U+200B, CR, LF, TAB, and U+001F;
3. consults `FUN_101dbbf0` for Hancom-specific unbreakable characters and
   object markers;
4. obtains candidate offsets from `FUN_10657c80` for the scanned segment;
5. measures a candidate through the run object's virtual method at vtable
   offset `0x24`, then scales it with `FUN_1030c000`;
6. accepts a candidate only when

```text
per_source_advance[candidate - source_start]
  + candidate_measure
  <= available_width
```

7. writes the selected source position and state byte to its output pair.

The routine at `HwpApp.dll+0x1dbbf0` is best labeled
`RequiresWordResolutionAtCursor`. A nonzero result enters the word-like
candidate branch; zero remains on the ordinary/control backward scan. Letters
and nonbreaking characters can both return nonzero, while captured Korean
units returned zero in another language/run context. It is therefore neither
a unary Unicode predicate nor the whole `break_allowed` relation.

`FUN_10657c80` is the candidate-offset generator used in the word-like branch.
It receives a UTF-16 segment pointer in `EDX`, segment length/offset values on
the stack, and returns a candidate offset or `-1` in `EAX`. It maps source
characters to internal classes and delegates part of the scan to
`FUN_10664110`. Accepted and rejected sequences are captured below. Naming the
internal class labels and concrete candidate-measure implementation behind
vtable offset `+0x24` remains extension work.

## Current Dynamic Boundary

The current document process emits the canonical baseline paragraph as:

```text
paragraph = 0x1dc6ab40
text      = "TJ5:WRAP \r"
length    = 10
width     = 38072
interval  = [0,10]
```

The descriptor oracle remains reliable. The attempted formatter bracket at
`HwpApp.dll+0x1dde10` did not establish that `formatter+0xa0` owns this
paragraph; diagnostics showed unrelated objects at that offset. Therefore no
advance or break event from that bracket is accepted as target evidence.

The input transport has one additional hard requirement: `SendInput` requires
a 28-byte `INPUT` record in the 32-bit process. Calls with 20 bytes are
rejected. Calls with 28 bytes are accepted by Windows, but a persistent Find
dialog or a caret on another table row can consume the input without changing
the target paragraph. A run is valid only when the target descriptor advances
from length 10 to the expected next length after each command.

### Live advance values

The table-cell paragraph `TB3:TAB ...` was edited from source length 45 to 44
and restored to 45. The selected intervals were exactly reversible:

```text
45: [0,8) [8,42) [42,45)
44: [0,8) [8,42) [42,44)
45: [0,8) [8,42) [42,45)
```

`CHncDrawContext::GetTextExtentExPointW` at
`HncBaseDraw.dll+0x62060` produced these cumulative `dx` arrays for the target:

```text
"TB3:TAB "
  [584, 1236, 1808, 2072, 2638, 3380, 4024, 4412]

34-code-unit Korean run
  [1100, 2200, ..., 36300, 37400]

"쪽끝"
  [1100, 2200]
```

The formatter completed the middle interval with `currentAdvance = 37400`
against available width `38072`. The direct backend call for the deleted
paragraph's 36-code-unit suffix returned `38888`, which does not fit. This
confirms that the formatter consumes the backend's per-source cumulative
advance and selects endpoints before the over-width suffix is committed.

During the same edit, `FUN_101dbbf0` was called while scanning the target
paragraph. Every observed Korean code unit and U+0020 returned `0` in this
context. The function therefore did not protect those positions from the
ordinary backward scan.

Inserting U+0020 at source index 28 made the paragraph length 46.
`FUN_101dd900`, called from `HwpApp.dll+0x1de778`, received overflow probe
position 38 and selected `(position = 29, state = 1)`. The resulting intervals
were `[0,29)` and `[29,46)`: the boundary is immediately after the space, and
the first interval owns the space at index 28. Its formatter advance was 37020,
which fits width 38072. Deleting that space restored the original text;
`FUN_101dd900` selected positions 8 and 42, and the intervals returned exactly
to `[0,8) [8,42) [42,45)`.

Therefore a reversible space edit is a deterministic transition over source
positions:

```text
insert U+0020 at 28: [0,8) [8,42) [42,45) -> [0,29) [29,46)
delete U+0020 at 28: [0,29) [29,46) -> [0,8) [8,42) [42,45)
```

`FUN_10657c80` and `FUN_101dd070` were not called for this Hangul path. The
universal operation is `FUN_101dd900`; it performs ordinary backward scanning
itself and conditionally delegates to `FUN_101dd070`. The specialized selector
and candidate generator must not be modeled as the general line-break entry.

The delegation was subsequently observed at `HwpApp.dll+0x1dda9d`. A selector
call with width 38072, overflow position 77, and state 1 returned
`(position = 72, state = 1)`. Other source states returned positions 73, 74,
75, and 17. That probe did not capture the owning paragraph, so those positions
are code-path evidence only and are not assigned to a named fixture case.

The condition for the candidate generator is exact in the decompiled selector:

```text
run_class = run_flags & 0x60
run_class == 0x20  => use FUN_10657c80 candidates and measure each candidate
run_class != 0x20  => return the selector's direct positional result
```

`TC2:LATIN` cannot be used as evidence until its descriptor oracle shows the
edited text; accepted Windows input without a changed target descriptor is
insufficient.

The native Latin paragraph was then changed through Hancom's paragraph dialog
to hyphenation mode. The active run object changed from flags `0x180` to
`0x1a0`, establishing the dynamic style mapping:

```text
0x180 & 0x60 = 0x00  keep-word branch
0x1a0 & 0x60 = 0x20  hyphenation-candidate branch
```

With `run_class = 0x20`, `FUN_101dd070` called `FUN_10657c80` from
`HwpApp.dll+0x1dd33e` at overflow positions 101, 122, 211, and 302. The
generator received the UTF-16 segment covering the concatenated
`Supercalifragilisticexpialidocious` source and called `FUN_10664110`. Both
returned `0xffffffff` (`-1`) for each observed segment, meaning that this input
contains no candidate accepted by the generator.

The resulting fallback sequence was:

```text
overflow  selector  wrapper
101       32        32
122       32        122
211       122       211
302       211       302
```

The emitted intervals were unchanged:

```text
[32,122) [122,211) [211,302) [302,309)
```

This proves the conditional call and its no-candidate result. It does not yet
establish the accepted-candidate return contract or candidate ordering.

### Accepted candidate in a table flow frame

A table-cell paragraph containing `internationalization` inherited run flags
`0x1a0`. Its default available width was 40932, so no break was required.
Hancom's native current-column resize command reduced the flow-frame width and
exercised accepted candidates.

At width 9236, overflow position 19 produced:

```text
FUN_10664110 result    7
FUN_10657c80 result    15
selector endpoint     16
wrapper endpoint      16
```

At width 8104, overflow position 17 caused repeated enumeration:

```text
FUN_10657c80 results  15, 13
selector endpoint     14
wrapper endpoint      14
```

Let `s` be the source origin of the UTF-16 segment passed to
`FUN_10657c80`, and let `h_r` be its `r`th returned candidate offset. The
captured mapping is:

```text
c_r = s + h_r + 1
```

Let `P_m(c_r)` be the formatter's cumulative per-source advance to `c_r` in
flow frame `F_m`, and let `M(c_r)` be the candidate measure obtained through
the run object's vtable method at `+0x24` and scaled by `FUN_1030c000`. The
selector accepts the first enumerated candidate satisfying:

```text
P_m(c_r) + M(c_r) <= W_m
```

Thus the specialized selector is:

```text
Q_m(s) = first c_r in Hancom candidate order
         such that P_m(c_r) + M(c_r) <= W_m
```

If no candidate satisfies the inequality, it returns its direct positional
fallback. `FUN_101dd900` then applies protected-boundary and overflow-state
semantics to `Q_m`; its result, not `Q_m` alone, is the final line endpoint.

At the settled cell width 1440, the descriptor oracle recorded source length
21 and intervals `[3,5) [5,7) [7,10) [10,12) [12,15) [15,18) [18,21)`.
The first interval was emitted before the settled probe attached, so its start
is not inferred here.

### Native Latin wrapper result

The native `hancom-latin-candidate.hwp` paragraph was edited by deleting and
reinserting its final `D`. Its available width was 42520, and the transition
was exactly reversible:

```text
309: [32,122) [122,211) [211,302) [302,309)
308: [32,122) [122,211) [211,302) [302,308)
309: [32,122) [122,211) [211,302) [302,309)
```

On both layout passes, `FUN_101dd900` received overflow position 302 and state
1. `FUN_101dd070` classified the active run object as:

```text
run_flags = 0x180
run_class = run_flags & 0x60 = 0
```

The selector returned `(position = 211, state = 1)`, but the wrapper returned
`(position = 302, state = 1)`. The emitted terminal descriptor began at 302.
Consequently, rhwp must represent selector output and finalized endpoint as
separate values. It must not publish `FUN_101dd070`'s return directly as the
line boundary:

```text
candidate_endpoint = 211
selected_endpoint  = 302
emitted_interval   = [302, source_length)
```

Changing the native paragraph-shape bits from `0x180` to `0x1a0` produced an
unstable HWP that terminated Hancom after rendering. That file is not evidence
for the `run_class == 0x20` branch. The accepted evidence is the style change
performed by Hancom itself, which produced flags `0x1a0` and dynamically
invoked `FUN_10657c80` in the stable native document.

### HWP3-converted mixed-script closure

The converted `hwp3-sample16-hwp5-2022.hwp` fixture contains a long paragraph
mixing Korean, Latin product names, punctuation, and spaces. A reversible GUI
edit inserted `x` immediately before `S/W`, waited for the inserted state to
finish formatting, then deleted it and waited for the restored state.

The descriptor sequence was:

```text
original: [0,54) [54,107) [107,159) [159,211)
inserted: [0,54) [54,107) [107,160) [160,212)
restored: [0,54) [54,107) [107,159) [159,211)
```

The first two endpoints were stable because the insertion occurred after
source position 107. Every affected downstream endpoint advanced by exactly
one source unit and returned exactly after deletion. `FUN_101dd900` finalized
the same transition:

```text
state       line starts        selected endpoints
original    0,54,107,159,211   54,107,159,211,261
inserted    0,54,107,160,212   54,107,160,212,262
restored    0,54,107,159,211   54,107,159,211,261
```

The terminal wrapper call selects two source units beyond the last descriptor
shown above because the capture excerpt stops before the remaining paragraph
descriptors; it is retained as wrapper evidence, not presented as a visible
line boundary in isolation.

No `FUN_101dd070` event occurred during either state. This establishes that
the mixed Korean/Latin edit remained on `FUN_101dd900`'s ordinary endpoint
path: the presence of Latin text does not itself select the specialized word
candidate branch. The formatter's run for the affected inserted line began
with `xS/W...`; its first advances were `672, 684, 788, 1296`, while the
restored run began with `S/W...` and `684, 788, 1296`. Endpoint movement
therefore followed the changed cumulative source sequence without changing
the surrounding flow-frame width or descriptor ownership.

Hancom deferred this document's reflow for several seconds. A 1.5-second
insert/delete driver produced only the final restored descriptors and is not
valid reversible evidence. The accepted driver held each state for 10 seconds
and required descriptors containing `xS/W` before deletion. The preserved raw
records are:

```text
~/Documents/hancom/captures/20260712-hysnmj-line-closure/raw/
  canonical-slow-reversible-pid7444.jsonl
  canonical-slow-drive-pid7444.jsonl

sha256 canonical-slow-reversible-pid7444.jsonl
  e0f6b2e1645f184dc089504064653fa0b1fc196188c8e485124f17f648139a00
sha256 canonical-slow-drive-pid7444.jsonl
  8054a86db0a1dfb14914491390009dda34069fa3a6efde544f4f686ede2fc4c1
```

### U+2000 ordinary-endpoint semantics

The same restored paragraph was used to sweep an explicitly open Unicode-space
case. U+2000 EN QUAD was inserted at source position 211, between the existing
spaces after `IP,` and the following Korean text. The target descriptor oracle
contained U+2000, so this is a document edit rather than a successful-but-
ignored `SendInput` call.

The complete interval transition was:

```text
original: [0,54) [54,107) [107,159) [159,211) [211,261) [261,271)
U+2000:   [0,54) [54,107) [107,159) [159,212) [212,262) [262,272)
restored: [0,54) [54,107) [107,159) [159,211) [211,261) [261,271)
```

U+2000 is therefore owned by the preceding interval: insertion changes
`[159,211)` to `[159,212)`, and the successor interval begins at 212. The
formatter exposed the inserted run with U+2000 at its boundary and assigned
the separator advance `1300` in this style. `FUN_101dd900` selected endpoint
212 directly; `FUN_101dd070` did not run. This dynamically confirms U+2000 as
an ordinary-scan stopping unit whose source position belongs to the completed
line in this context.

The attempted U+2007, U+200B, and U+3000 cases remain open. Their driver calls
returned success, but no target descriptor contained those code points before
restoration, so they are explicitly rejected as semantic evidence. A final
redraw verified the original text and all six original intervals after the
sweep.

```text
~/Documents/hancom/captures/20260712-hysnmj-line-closure/raw/
  canonical-unicode-space-sweep15-pid7444.jsonl
  canonical-unicode-space-driver15-pid7444.jsonl
  canonical-post-sweep15-verify-pid7444.jsonl

sha256 canonical-unicode-space-sweep15-pid7444.jsonl
  15991540ef60ef4d561a9c2d742e7c29030281139b1f7db4d907b1db34fc688c
sha256 canonical-unicode-space-driver15-pid7444.jsonl
  e7a32e84ca6920b1b41637d86f51277c1ed3a4e91e211a2fd230d86479ce270a
sha256 canonical-post-sweep15-verify-pid7444.jsonl
  906c08e2655b16d00887f3ded9d51849254e716278688654a68cb689c9c7b179
```

## rhwp Representation Requirement

The engine needs one canonical layout state for every paragraph context,
including body text, table cells, footnotes, endnotes, and text-bearing
objects:

```text
cumulative_advance[cursor | line_start, slot, style]
break_relation[cursor | layout_context]
flow_interval[line]
selected_endpoint[line]
```

The first two terms are deliberately contextual. The native source address is
the pair `(offset,state)`, not an integer position. The measured cumulative
advance array is indexed from the current source origin and is valid only for
the active slot and style state. Likewise, the wrapper does not read one
context-free break-class array. It combines the cursor unit, address state,
run mode, adjacent units, and control/object queries while scanning.

The four code-level observables currently have this status:

```text
cumulative_advance:
  GetTextExtentExPointW cumulative dx values consumed by the formatter

break_relation:
  contextual resolver predicates plus cursor predecessor/successor operations;
  not a scalar character class

flow_interval:
  descriptor [slot_left, slot_left + slot_width), owner-relative

selected_endpoint:
  ResolveLineEndpoint output (offset,state), committed as descriptor source_end
```

The emitted 0x3c-byte descriptor records the horizontal slot at offsets
`0x18` and `0x1c`, and source interval endpoints at offsets `0x00` and `0x2c`.
For example, an observed 47-unit body paragraph emitted:

```text
line 0: source [0,40),  slot [0,48188)
line 1: source [40,47), slot [0,48188)
```

This descriptor proves the committed line interval and flow slot. It does not
by itself expose the candidate preference order that produced source endpoint
40; that order remains a responsibility of the contextual endpoint resolver.

The subsequent endpoint-priority capture resolves the ordinary scan kernel.
At candidate cursor `c`, Hancom inspects `p = pred_D(c)`. Header/footer (`0x10`)
and footnote/endnote (`0x11`) controls with a nonzero payload are crossed by
moving to `p`. A word-resolution unit delegates to the mode selector. SPACE,
U+3000, U+2000..U+200B, CR, LF, TAB, and U+001F stop the scan and select `c`,
so the complete preceding source span belongs to the line.

The native TAB action produced eight-unit spans:

```text
[43,51): pred(51)=43, selected=51
[29,37): pred(37)=29, selected=37
```

The selector's source-step mask is `0x00ffdbfe`. Any selected control code
below U+0020 advances by eight source units; the mask includes `0x0B`, the HWP
code used by table, shape, picture, equation, and related drawing controls.
The source cursor therefore crosses those controls atomically. Object width is
not encoded by this source span: the line producer resolves the `0x0B` object
and separately tests bit 0 at object field `+0x4c`. Set enters full object
layout; clear follows the generic zero-filled atomic-control path. The
behavioral label is `ParticipatesInInlineFlow`, consistent with HWP's
common-object `treat_as_char` bit 0 but not asserted as a recovered symbol.

The control advance path is narrower than that source-span result.
`HwpApp+0x1d75b0` tests `0x00e7d80e`, resolves a control, and invokes vtable
slot `+0x14c`. The selected codes are:

```text
0x01, 0x02, 0x03, 0x0B, 0x0C, 0x0E, 0x0F,
0x10, 0x11, 0x12, 0x15, 0x16, 0x17
```

For the TAC table fixture, RTTI identified `CHwpTable`; its vtable slot
`+0x14c` targets `HwpApp+0x1bb240`. Three formatter callers returned `14120`,
including the reversible insert/delete edit. The fixture fields give the exact
identity:

```text
14120 = table width 13554 + left outer margin 283 + right outer margin 283
```

The implementation gates on object field `+0x4c` bit 0, obtains the primary
placement record through vtable slot `+0x1b0`, and returns placement field
`+0x14` or `+0x18` according to a context resolver. Fragment zero is embedded
at object offset `+0xd0`; later fragments are read from the placement array at
`+0x168`. This proves that table advance is selected placement geometry rather
than a direct read of a source width field.

An independent in-memory MSVC RTTI walk then resolved the offset-zero primary
vtables. `CHwpShapeObject` primary slot `+0x14c` also targets
`HwpApp+0x1bb240`, so table controls and generic shape-object controls share
the placement-extent calculation. The concrete `CHwpPicture` and
`CHwpShapeComponent` primary vtables instead target `HwpApp+0x062bd0`, which
is a constant-return interface method. Their same numeric slot is not the
paragraph-control slot. A picture's paragraph advance must be associated with
its owning `CHwpShapeObject`; direct picture-component width dispatch is not a
canonical native operation.

The RTTI map does not prove which shape-object instance owns a particular
picture component. A dynamic body-picture `resolve-control` event is still
required for that correlation.

The context selector at `HwpApp+0x02ff50` returns an integer orientation class
in `0..7`, not a boolean. One accepted path extracts
`(layout_context.flags_0x7c >> 1) & 7` after owner-capability and native-control
kind checks. `HwpApp+0x1bb240` then returns placement field `+0x14` for class
zero and field `+0x18` for every nonzero class. This resolves the switch
equation while leaving the semantic class names open. A TAC rerun intended to
correlate the ordinary table with its class value stalled in COM `Hwp.Open`
before layout and is rejected as dynamic evidence.

A subsequent direct GUI run removed the body-picture blocker. In
`pic-in-table-with-toggle.hwp`, the two TAC pictures resolved as
`CHwpGenShapeObject` with vtable RVA `0x757c6c`; slot `+0x14c` targeted
`HwpApp+0x1bb240`. The ordinary layout context returned orientation class zero.
The selected extents were `16942` and `12257`, exactly matching the respective
picture widths because both horizontal outer margins were zero.

Two reversible edit cycles were performed adjacent to the body picture:
U+314C insert/delete and `x` insert/delete. Every reflow reproduced the same
shape objects, orientation class zero, and advances. This dynamically proves
that paragraph picture advance belongs to the generated shape-object wrapper,
not the concrete picture-component vtable.

A second controlled GUI pass changed the containing table cell to
`세로쓰기(영문 세움)`. Insertion and deletion of `x` both produced orientation
class `2` for the vertical-writing owner. The table fragment placement remained
`field +0x14 = 42520` and `field +0x18 = 39354`; two distinct generated-picture
wrappers returned selected extents `1154` and `7880`. The deletion pass
reproduced all four values. This dynamically maps class `2` to upright-English
vertical cell writing in this fixture and exercises the nonzero-class selector
branch. The table placement tuple and picture-wrapper extents are separate
objects and must not be conflated. Classes `1` and `3..7` remain unmapped.

In the non-TAC floating fixture, no floating drawing object entered this
virtual advance path. The only resolved controls were `CHwpSecDef` and
`CHwpColDef`, whose shared implementation at `HwpApp+0x1e6d20` always returns
zero. The picture fixture did not reach its edit because `Hwp.Open` blocked;
that empty run is rejected rather than converted into a picture rule.

The paired nonbreaking-space cases produced:

```text
SPACE 28 < NBSP 44 < overflow 65 => selected 29
NBSP 28 < SPACE 44 < overflow 65 => selected 45
```

The explicit soft line break was U+000A at source 25; the successor line began
at 26 before width-overflow resolution. Detailed evidence is preserved in:

```text
~/Documents/hancom/captures/
  20260711-212601-hwpapp-endpoint-priority/
```

The same state must drive paint, hit testing, caret movement, editing, and
pagination. No field or branch may select behavior based on whether geometry
was stored, imported, generated, or edited. Reversible edits must reproduce the
same arrays and endpoints, not merely a visually similar line count.

Static evidence for this map is preserved under:

```text
~/Documents/hancom/captures/
  20260711-000652-hwpapp-code-level-line-layout/static/
```

The native Latin reversible run is preserved as:

```text
raw/trace_break_candidates_all_threads-pid6244-original-r4-live.jsonl
raw/trace_native_candidate_descriptors-pid6244-original-r4-live.jsonl
raw/trace_native_candidate_descriptors-pid6244-table-settled-live.jsonl
```
