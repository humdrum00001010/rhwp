# Hancom Line-Break Model

This document states the line-break model recovered from Hancom's formatter.
It separates proved relations from transition kernels that still require
capture. It defines one canonical layout path; it has no stored, imported,
generated, or edited geometry mode.

## 1. Source Cursors And Flow State

Hancom does not address layout solely by a UTF-16 integer. Its endpoint record
contains a source offset and a state byte, and its backward operation can move
over more than one UTF-16 unit. Define the native cursor domain:

```text
C_D = {(i, q) | the source accessor resolves offset i in address state q}
```

with document order `<_D`, predecessor `pred_D`, and successor `succ_D`. For a
cursor `c = (i,q)`, `unit_D(c)` is the text unit, control, or object marker at
that cursor. The observed backward operation is therefore represented as:

```text
pred_D(i,q) = (i - Delta_D(i,q), q')
```

where `Delta_D` is one for ordinary UTF-16 units but may cover a Korean cluster,
a control span, or another native source unit. The successor may change the
address state from `q` to `q'`; the model does not collapse that state into
file provenance or geometry provenance.

Let `b_k in C_D` be the cursor at which line `k` begins.

Let `(F, <)` be Hancom's ordered set of flow frames. A frame is:

```text
F_m = (page_m, column_m, owner_m, Y_m, H_m, Omega_m, K_m)
```

where:

- `page_m` and `column_m` identify the page and column flow coordinates;
- `owner_m` identifies the body, cell, note, or text-object flow owner;
- `Y_m` is the frame's vertical origin;
- `H_m` is usable vertical height;
- `Omega_m(y)` is the ordered set of usable horizontal slots at vertical
  position `y`;
- `K_m` is the frame constraint state.

A slot `omega in Omega_m(y)` is an interval `[l_omega,r_omega)` with width:

```text
W(omega) = r_omega - l_omega
```

`Omega_m` is height-dependent because margins, cell padding, floating-object
exclusions, and text wrapping can change the usable interval. A table cell is
not a special line-breaking mode; it supplies a nested frame and its own slot
geometry.

Body columns, table cells, footnote regions, endnote regions, and text-bearing
objects are flow frames. Their order is document flow order, not a paint order.

Let `S` contain paragraph, character, font, matrix, spacing, language, and
object style state. Let the Latin break mode be:

```text
lambda in {KEEP_WORD, HYPHENATION, BREAK_WORD}
```

The captured native flags are:

```text
KEEP_WORD    : run_flags & 0x60 = 0x00
HYPHENATION  : run_flags & 0x60 = 0x20
BREAK_WORD   : direct positional wrapper path
```

## 2. Effective Horizontal Advance

For cursor interval `[a,b)_D` in slot `omega`, define:

```text
A_omega(a,b;S) = sum(c in [a,b)_D) [g_c + r_c + s_c + p_c + o_c]
```

where:

- `g_c` is shaped glyph advance;
- `r_c` is font-ratio and matrix scaling;
- `s_c` is character and language spacing;
- `p_c` is pair and boundary adjustment;
- `o_c` is control, tab, or object advance.

The effective value is produced in this semantic order:

```text
script/language/font segmentation
  -> glyph or legacy character advance
  -> cumulative source-cursor advances
  -> character/pair/control adjustments
  -> line-slot accumulation
```

Let the formatter's cumulative value be:

```text
P_omega(a,b) = A_omega(a,b;S)
```

The formatter obtains an overflow probe `o_k in C_D` at the horizontal limit.
The endpoint resolver receives `o_k`; this model does not assume that it is
already the final line endpoint.

### 2.1 Canonical Layout Observables

For an active line start `b_k`, slot `omega`, and style state `S`, Hancom's
measured advance is a contextual cumulative map:

```text
Advance_k(c) = P_omega(b_k,c;S), c in [b_k,o_k]_D
```

It is not a document-global `advance[position]` array. The native backend
returns cumulative per-source values for the measured run, and the formatter
combines those values with run, pair, control, and object adjustments.

The corresponding break datum is also contextual:

```text
BreakContext_k(c) = (
  unit_D(c), address_state(c), lambda(c),
  unit_D(pred_D(c)), control_state(c), object_state(c), S
)
```

`BreakContext_k(c)` is an input tuple to the relations in section 5, not a
numeric class whose value alone determines admissibility.

For each committed line descriptor `d_k`, define:

```text
FlowInterval(d_k) = [d_k.slot_left, d_k.slot_left + d_k.slot_width)
SelectedEndpoint(L_k) = e_k = (i_k,q_k)
d_k.source_end = i_k
```

The observed 0x3c-byte descriptor stores `slot_left`, `slot_width`, and
`source_end` at offsets `0x18`, `0x1c`, and `0x2c`. The state byte is produced
by endpoint resolution and must remain in RHWP's canonical endpoint; the
observed descriptor path commits the pair's integer offset as `source_end`.

### 2.2 Endpoint And Font-Matrix Closure

Endpoint selection and line adjustment are one coupled relation. Let `M_k` be
the per-line font/spacing matrix applied to the candidate interval. Define:

```text
P_omega^M(a,c) = sum(t in [a,c)_D) AdjustAdvance(t,M_k,S)
```

The selected endpoint and matrix satisfy the fixed-point relation:

```text
(e_k,M_k) = LineClosure(b_k,omega,S)

e_k = ResolveEndpoint(Gamma_k with advances = P_omega^M)
P_omega^M(b_k,e_k) <= W(omega) + EndDecoration(e_k)
```

`M_k` is line-local. It is not a paragraph-wide font ratio and it is not a
paint-only transform applied after an independently selected endpoint.

The open-source contest paragraph gives a concrete dynamic observation:

```text
slot width                    48188
committed source intervals   [0,54), [54,124), [124,144)
line 1 ordinary Hangul dx    915 for nominal height 1400
line 1 ordinary SPACE dx     560 for nominal height 1400
```

The same paragraph's other lines use different advances for the same nominal
character styles. Therefore full-em measurement followed by greedy endpoint
selection is not equivalent to Hancom. RHWP must retain the committed
endpoint partition while solving the line matrix; it must not merge adjacent
partitions before the matrix stage.

An ordinary text edit updates source cursors inside this canonical state. It
does not switch the paragraph to a generated/reflow mode. A structural newline
changes the partition relation itself and therefore requires a new closure.

### 2.3 Native Control And Object Advance

Source cursor span and horizontal advance are independent. For a native
control at cursor `c`, define:

```text
VirtualAdvanceControl =
  {0x01,0x02,0x03,0x0B,0x0C,0x0E,0x0F,0x10,0x11,0x12,0x15,0x16,0x17}

ControlAdvance(c | Gamma) =
  0                                      if unit_D(c) not in VirtualAdvanceControl
  0                                      if ControlAt(c) is absent
  VirtualAdvance(ControlAt(c),Gamma)     otherwise
```

The native dispatcher implements `VirtualAdvance` through control vtable slot
`+0x14c`. This relation does not depend on file origin, edit history, or a
saved/generated geometry mode.

For a table object `t`, fragment `r`, and layout context `Gamma`, define:

```text
Placement(t,r | Gamma) =
  primary_placement(t)                    if r = 0
  additional_placement(t,r - 1)           if r > 0 and that placement exists
  null                                    otherwise

TableAdvance(t,r | Gamma) =
  0                                      if not ParticipatesInInlineFlow(t)
  0                                      if Placement(t,r | Gamma) = null
  SelectedPlacementExtent(Placement(t,r | Gamma),Gamma) otherwise

ShapeObjectAdvance(s,r | Gamma) =
  0                                      if not ParticipatesInInlineFlow(s)
  0                                      if Placement(s,r | Gamma) = null
  SelectedPlacementExtent(Placement(s,r | Gamma),Gamma) otherwise
```

The selector is exact:

```text
OrientationClass(Gamma) in {0,1,2,3,4,5,6,7}

SelectedPlacementExtent(p,Gamma) =
  p.field_0x14  if OrientationClass(Gamma) = 0
  p.field_0x18  otherwise
```

One native path derives the class as `(layout_flags_0x7c >> 1) & 7`, after
owner-capability and native-control-kind checks. The semantic names of the
eight classes remain unproved. In the controlled TAC table fixture:

```text
TableAdvance = width + outer_margin_left + outer_margin_right
             = 13554 + 283 + 283
             = 14120
```

For a `0x0B` drawing control with `ParticipatesInInlineFlow = false`, the
layout producer remains on the generic atomic-control path and contributes
zero horizontal advance. The object is still an eight-unit atomic source span;
zero advance does not remove it from the cursor domain.

`CHwpTable` and the primary `CHwpShapeObject` control vtable both implement
slot `+0x14c` with the same native function. Concrete `CHwpPicture` and
`CHwpShapeComponent` primary vtables do not: their apparent slot returns a
constant and belongs to another interface layout. A picture's line advance
must therefore be resolved through its owning shape-object control, not by
calling a same-offset method on the picture component.

The controlled body-picture fixture proves that ownership dynamically. Both
TAC pictures resolved as `CHwpGenShapeObject` with advance target
`HwpApp+0x1bb240` and orientation class zero:

```text
PictureShapeAdvance_0 = 16942 = picture width 16942
PictureShapeAdvance_1 = 12257 = picture width 12257
```

Both pictures had zero outer horizontal margins. Insert/delete cycles with
U+314C and `x` reproduced the same two advances. Thus the ordinary class-zero
picture relation is:

```text
PictureShapeAdvance(p | Gamma_0) =
  picture_width(p) + outer_margin_left(p) + outer_margin_right(p)
```

This is an instance of `ShapeObjectAdvance`, not a separate picture-component
measurement path.

## 3. Hyphenation Candidate Selection

For a word segment beginning at source cursor `s`, Hancom's candidate
generator returns offsets in its own order:

```text
G(s) = (h_0, h_1, ..., h_r)
```

The dynamically proved source mapping is:

```text
c_q = advance_D(s, h_q + 1)
```

Let `M(c_q)` be the run-specific decoration measure for candidate `c_q`.

The specialized selector is:

```text
Q_omega(s) = first c_q in Hancom candidate order
             such that P_omega(b_k,c_q) + M(c_q) <= W(omega)
```

If the generator returns `-1`, or no candidate satisfies the inequality, the
selector returns its direct positional fallback.

The accepted table-cell captures are:

```text
W=9236, o=19, G=(15, ...), Q=16
W=8104, o=17, G=(15, 13, ...), Q=14
```

The no-candidate paragraph capture returned `-1` for every examined segment.

## 4. Break-Mode Result

Let `Q_lambda` be the mode-specific intermediate endpoint:

```text
Q_lambda =
  Q_KEEP(b_k, o_k, S)  when lambda = KEEP_WORD
  Q_omega(s)            when lambda = HYPHENATION
  o_k                   when lambda = BREAK_WORD
```

`Q_lambda` is not the final line endpoint.

## 5. Canonical Endpoint Resolution

A unary character predicate cannot define Hancom line breaking. The same code
unit can be ordinary, protected, or part of a control depending on source
address state, language, run flags, and adjacent objects. Define the layout
context at a probe as:

```text
Gamma_k = (D, S, lambda, omega, b_k, o_k, object_state, control_state)
```

and define these semantic relations over native cursors:

```text
Protected(c | Gamma_k)       c belongs to a span that cannot be split here
Forced(c | Gamma_k)          c terminates the line independent of width
OrdinaryBoundary(c | Gamma_k)c is an ordinary break boundary
ObjectBoundary(c | Gamma_k)  c is an admissible edge of an atomic object/control
HyphenCandidate(c | Gamma_k) c is emitted by the active hyphenation policy
```

The candidate set is:

```text
B(Gamma_k) = {c | Forced(c) or OrdinaryBoundary(c) or ObjectBoundary(c)
                   or HyphenCandidate(c) or c is a grapheme fallback}
```

Hancom imposes a context-dependent preference order `prec_Gamma` on that set.
It is not equivalent to source order and is not equivalent to "the longest
prefix that fits". The endpoint is:

```text
b_{k+1} = min_{prec_Gamma} {
  c in B(Gamma_k)
  | Forced(c | Gamma_k)
    or (Fits_omega(b_k,c) and SpanAllowed(b_k,c | Gamma_k))
}
```

where:

```text
Fits_omega(a,c) := P_omega(a,c) + Decoration(c | Gamma_k) <= W(omega)
```

If the preferred set is empty, the active break mode supplies its direct
cursor fallback. Endpoint ownership is part of the relation: for U+0020 the
captured endpoint is after the space, while U+00A0, U+FEFF, and U+2011 do not
create that ordinary boundary.

The captured keep-word override is:

```text
Q_KEEP = 211
ResolveEndpoint(...) = 302
```

The captured accepted hyphenation case is:

```text
Q_omega = 16
ResolveEndpoint(...) = 16
```

Therefore:

```text
ResolveEndpoint(Gamma_k) != Q_lambda in general
```

### 5.1 Word-Resolution Class Evidence

The observed class probe is context-dependent:

```text
RequiresWordResolution(c | D,S,q) in {0,1}
```

The controlled boundary sweep gives:

```text
RequiresWordResolution(U+0020 SPACE)           = 0
RequiresWordResolution(U+0009 TAB)             = 0
RequiresWordResolution(U+00A0 NO-BREAK SPACE)  = 1
RequiresWordResolution(U+FEFF ZERO WIDTH NBSP) = 1
RequiresWordResolution(U+2011 NON-BREAK HYPHEN)= 1
RequiresWordResolution('A') = RequiresWordResolution('B') = 1
```

Nonzero makes the universal resolver enter its word-like candidate branch; it
does not by itself mean "unbreakable." Protection is derived from this class,
the run mode, neighboring units, and object/control state. In another captured
language/run context Korean units and U+0020 both returned zero, so the
relation must retain `D`, `S`, and `q`. In the space sweep, crossing U+0020
selected the cursor immediately after that space. U+00A0, U+FEFF, and U+2011
entered word-like handling and did not create an ordinary-space boundary.

TAB also produced zero, but it is not an ordinary one-position space. It
follows the control branch with a native source span and tab-stop advance. This
is why the cursor domain and `ObjectBoundary`/`control_state` are explicit.

### 5.2 Backward Scan And Endpoint Ownership

Let `c` be the current candidate endpoint and `p = pred_D(c)`. Define the
statically recovered ordinary stop relation:

```text
StopUnit(p) := unit_D(p) in {
  U+0020, U+3000, U+2000..U+200B,
  U+000D, U+000A, U+0009, U+001F
}
```

The resolver also queries two out-of-band HWP control classes at `c`:

```text
AnchorPayload(c) :=
  exists t in {HEADER_FOOTER = 0x10, FOOTNOTE_ENDNOTE = 0x11}:
    ControlAt(c,t) != null and ControlAt(c,t).payload != 0
```

These classes are not treat-as-character drawing objects. A matched anchor is
crossed by moving to `p`; it is not selected as an endpoint. The scan kernel is:

```text
Scan(c | Gamma_k) =
  Scan(p | Gamma_k)                     if AnchorPayload(c)
  SelectWordBreakCandidate(c | Gamma_k) if RequiresWordResolution(p | Gamma_k)
  c                                     if StopUnit(p)
  Scan(p | Gamma_k)                     otherwise
```

The returned ordinary endpoint is `c`, not `p`. This gives separator ownership
to the preceding line. The native TAB capture proves why that distinction is
required:

```text
TAB span       = [43,51)
pred_D(51)     = 43
Delta_D(51)    = 8
unit_D(43)     = U+0009
selected cursor= 51
```

A TAB-only fixture reproduced span `[29,37)` and selected cursor 37. TAB is
therefore an atomic source span whose complete tab-stop advance belongs to the
line ending at its successor cursor.

The same candidate selector defines native control span length with mask
`0x00ffdbfe`:

```text
span_D(p) = 8  if unit_D(p) < U+0020 and
                  ((1 << unit_D(p)) & 0x00ffdbfe) != 0
span_D(p) = 1  otherwise
succ_D(p) = p + span_D(p)
```

Control code `0x0B` is included in that mask. The HWP control map assigns
`0x0B` to table, shape, picture, equation, form, hyperlink, ruby, and unknown
drawing controls. Their source interval is therefore atomic and eight units
wide. This establishes cursor ownership only. The layout producer separately
resolves the `0x0B` object and applies:

```text
ParticipatesInInlineFlow(o) := (flags_{+0x4c}(o) & 1) != 0
```

A true result enters full object layout. A false result remains on the generic
atomic-control path, whose advance-buffer slots are zero-filled. The semantic
label describes the statically observed effect and agrees with HWP's
common-object `treat_as_char` bit 0; it is not a recovered native field name.

The control-advance dispatcher uses a separate mask, `0x00e7d80e`, to select
the native control codes that invoke polymorphic vtable slot `+0x14c`. This is
why neither the eight-unit source span nor the inline-flow flag can be used as
a substitute for `ControlAdvance(c | Gamma)`.

The paired SPACE/NBSP captures establish positional behavior through this
kernel:

```text
SPACE 28 < NBSP 44 < overflow 65  => selected 29
NBSP 28 < SPACE 44 < overflow 65  => selected 45
```

NBSP enters word resolution; it is not an ordinary stop. On the line beginning
at 29 with no later ordinary stop, the intermediate word candidate was 29 but
the universal resolver committed overflow 93.

Hancom's explicit soft line break is U+000A. In the controlled paragraph it
occupied source 25 and the successor line began at 26 before width resolution:

```text
unit_D(25) = U+000A
b_{k+1} = 26
```

The loop statically includes U+001F, but attempted insertion through the text
action was discarded; its dynamic source-span behavior remains unproved.

## 6. Vertical Placement And Frame Transition

Let `L_k` be the line selected by `ResolveEndpoint`, and let `V(L_k)` be its
vertical extent. The current frame is vertically feasible when:

```text
y_k + V(L_k) <= Y_m + H_m
```

Let `Admissible(F_r, L_k, Gamma_k)` contain the vertical and structural constraints.
When the current frame is not admissible, choose the least later admissible
frame in flow order:

```text
m' = min_{<} {r | F_m < F_r and Admissible(F_r, L_k, Gamma_k)}
```

Because `Omega_{m'}` may differ from `Omega_m`, horizontal selection must be
recomputed in a slot of `F_{m'}`:

```text
b_{k+1} = ResolveEndpoint(Gamma_k with frame = F_{m'})
```

The automatic body-frame capture gives the concrete transition boundary:

```text
H_m = 65762
y_m = 65600
the current-placement rejection branch runs before the next placement
successor-frame layout completes with y_{m'} = 10600
```

The incremental path returns result class `2` for an ordinary body paragraph
and has a distinct result class `3` branch for a table owner. These are
evidence that owner transitions are part of `K_m`; they are not mathematical
layout states themselves.

Page and column breaking are therefore coupled to horizontal line selection;
they are not a downstream clipping operation.

### 6.1 Footnote Reservation

For notes anchored on the current page, let `N_m` be the ordered note-frame
set and define the reservation function:

```text
rho(N_m, S) = note lines + separator + note margins + note spacing
```

The body frame's admissibility condition is:

```text
y_k + V(L_k) <= Y_m + H_m - rho(N_m, S)
```

The controlled footnote capture produced a nested owner before the body pass
completed:

```text
body owner      0x165e4294: limit 65762, used 1000
footnote owner  0x167e24b4: limit 63345, used 900
observed reservation: 65762 - 63345 = 2417
```

The `2417` value belongs only to that fixture. Its excess over the 900-unit
note line is evidence that `rho` includes separator/margin policy. A footnote
is therefore an ordered flow frame participating in page admissibility, not a
post-layout overlay.

### 6.2 Paragraph Flow Directives

Let the paragraph header break byte be `beta(p)`. Its source semantics are:

```text
section(p)     := (beta(p) & 0x01) != 0
multicolumn(p) := (beta(p) & 0x02) != 0
page(p)        := (beta(p) & 0x04) != 0 or page_break_before(style(p))
column(p)      := (beta(p) & 0x08) != 0
```

The native precedence observed in the resolver is represented by the raw
directive vector:

```text
d_0(p) = (s_f,p_f,c_f,m_f)
```

where `s_f`, `p_f`, `c_f`, and `m_f` are respectively the section, page,
column, and multicolumn components:

```text
d_0(p) =
  (1,0,0,0)  if section(p)
  (0,page(p),0,1) if multicolumn(p)
  (0,0,1,0)  if column(p)
  (0,1,0,0)  if page(p)
  (0,0,0,0)  otherwise
```

The directive is normalized by current flow capabilities, not consumed as an
unconditional command. Let `P(Gamma)` mean that page/section transition is
available, `C(Gamma)` mean that column-family transition is available, and
`last_column(Gamma)` identify the terminal column:

```text
N_Gamma(s_f,p_f,c_f,m_f) =
  (s_f and P(Gamma),
   p_f and P(Gamma),
   c_f and C(Gamma),
   m_f and C(Gamma))
```

The earlier static interpretation that a plain column directive is always
cleared in the terminal column is superseded by the native two-column trace:
the resolver returned `0x400` with the captured column field equal to both
zero and one. The exact terminal-column normalization or internal successor
dispatch remains open.

The transition family is then selected canonically:

```text
T_Gamma(d) =
  T_section       if d.s_f
  T_page          if d.m_f and d.p_f
  T_column_family if d.m_f or d.c_f
  T_page          if d.p_f
  T_automatic     otherwise
```

This reproduces the static dispatch: section is distinct; page combined with
multicolumn enters the page family; multicolumn and column enter the same
column-family branch; plain page enters the page family. Controlled edits
proved page and column cases dynamically. A two-column fixture additionally
proved `column 0 -> column 1`. The terminal-column, section, and multicolumn
geometry remains open. The complete vertical equations are in
`hancom-pagination-owner-constraints.md`.

## 7. General Recurrence

The canonical state before line `k` is:

```text
X_k = (b_k, m_k, y_k, note_state_k, owner_state_k, flow_state_k)
```

First normalize a paragraph directive and, when it applies at `b_k`, move to
the selected flow family:

```text
d_k = N_{Gamma_k}(d_0(paragraph(b_k)))
F_r = T_{Gamma_k}(d_k, F_{m_k})
```

For each slot `omega in Omega_r(y_k)`, resolve a candidate line:

```text
o_k     = first overflow or forced cursor from b_k in omega
e_k     = ResolveEndpoint(Gamma_k with probe = o_k)
L_k     = D[b_k,e_k)_D
N'_k    = note_state_k union NotesAnchoredBy(L_k)
H_eff   = H_r - rho(N'_k,S)
```

The placement is accepted exactly when its horizontal slot, vertical budget,
owner constraints, and flow constraints all hold:

```text
Accept(F_r,omega,L_k | Gamma_k)
  := FitsSlot(F_r,omega,L_k)
     and y_k + V(L_k) <= Y_r + H_eff
     and OwnerAllows(owner_r,L_k,K_r)
     and FlowAllows(flow_state_k,F_r,K_r)
```

If acceptance fails, apply `T_automatic` to the least later candidate frame,
obtain that frame's slots, and recompute `o_k`, `e_k`, `L_k`, and note
reservation. The recurrence is:

```text
X_{k+1} = Phi_{Hancom}(X_k,D,S,F)
```

with:

```text
b_{k+1} = e_k
y_{k+1} = baseline_successor(y_k,V(L_k),K_r)
```

This is one deterministic layout transition. There is no stored/imported/edit
branch. Reversing an edit must restore the same state sequence:

```text
E^-1(E(D)) = D
  =>
Phi_Hancom^*(X_0,E^-1(E(D)),S,F) = Phi_Hancom^*(X_0,D,S,F)
```

The recurrence requires all of the following, rather than treating any one as
the complete line-break rule:

1. effective advance computation in `F_m`;
2. native-cursor probing and predecessor movement;
3. context-dependent endpoint ordering;
4. protected/control/object span ownership;
5. note-aware vertical admissibility;
6. normalized paragraph flow directives;
7. owner-specific frame transition;
8. full horizontal recomputation in every new slot.

## 8. Proven And Open Terms

Dynamically proved:

- cumulative font-backend advance consumption;
- reversible source-position geometry;
- keep-word selector/wrapper separation;
- direct break-word endpoints;
- hyphenation run-class gate;
- no-candidate and accepted-candidate paths;
- `candidate_endpoint = segment_origin + offset + 1`;
- candidate fit inequality;
- table-cell content rectangle as the line slot `omega`;
- owner-relative descriptor slot fields at `+0x18` and `+0x1c`;
- committed descriptor source end at `+0x2c`;
- word-resolution class values for U+0020, U+0009, U+00A0,
  U+FEFF, U+2011, and ordinary Latin letters;
- ordinary-space finalization at the post-space source position;
- nonbreaking-space/hyphen characters do not enter that ordinary-space path;
- backward positional ordering between SPACE and NBSP;
- native TAB as an eight-unit atomic span with post-span endpoint ownership;
- explicit U+000A line transition before successor-line width resolution;
- explicit page-break class `0x200` before flow-position commit;
- explicit column-break class `0x400` before flow-position commit;
- two-column `0x400` transition from column zero to column one;
- `0x400` resolver output in both column zero and terminal column one;
- automatic current-frame rejection at the captured vertical limit;
- successor-frame layout as a separate horizontal/vertical pass;
- incremental body reflow path and its result class `2`;
- nested footnote owner and fixture-specific vertical reservation;
- widow/orphan rejection of a one-line partial placement;
- keep-lines rejection of a one-line partial placement;
- keep-with-next chain rewind to an earlier paragraph at line zero;
- repeated outer-owner continuation for a native 84-row table;
- TAC table advance `14120 = width 13554 + outer margins 283 + 283`;
- reversible table edit preserving that same selected placement extent;
- non-inline floating drawing objects bypassing polymorphic horizontal advance;
- body TAC pictures resolving through `CHwpGenShapeObject` with reversible
  advances equal to widths `16942` and `12257` in orientation class zero;
- upright-English vertical table-cell writing resolving to orientation class
  `2`, with reversible table placement fields `42520` and `39354` and distinct
  generated-picture selected extents `1154` and `7880`.

Statically and format-semantically proved:

- the source break-byte meanings `Section=0x01`, `MultiColumn=0x02`,
  `Page=0x04`, and `Column=0x08`;
- directive precedence `Section`, `MultiColumn(+Page)`, `Column`, `Page`;
- independent context masks for page-family and column-family directives;
- section, page, column-family, automatic, and terminal dispatch families;
- backward source movement is cluster/control aware and is not integer `i-1`;
- native control codes selected by mask `0x00ffdbfe`, including inline-object
  code `0x0B`, occupy atomic eight-unit source spans;
- object field `+0x4c` bit 0 selects full inline-object layout instead of the
  generic zero-filled atomic-control advance path;
- control mask `0x00e7d80e` selects the classes whose object vtable slot
  `+0x14c` supplies horizontal advance;
- `CHwpTable` vtable slot `+0x14c` returns a context-selected field from its
  fragment placement record and returns zero without inline participation or
  placement;
- primary `CHwpShapeObject` slot `+0x14c` is the same placement-extent
  implementation as `CHwpTable`;
- concrete picture/component primary vtables have a different interface
  layout and cannot supply paragraph advance by same-offset dispatch;
- primary table placement is embedded at `+0xd0`; later fragment placements
  are obtained through the array at `+0x168`;
- endpoint output carries a source offset and a native address-state byte;
- the usable horizontal domain must be a slot supplied by its flow owner.

Statically identified but not yet fully parameterized:

- special handling for CR, U+001F, and Unicode-space variants not yet swept
  dynamically;
- matched header/footer and footnote/endnote control anchors in endpoint
  resolution;
- descriptor emission after wrapper finalization.

Still requiring controlled captures:

- dynamic correlation from equation, form, hyperlink, ruby, and unknown
  drawing components to their owning `CHwpShapeObject` control;
- exact selected placement extent for each resulting shape-object placement;
- semantic names and owner meaning for placement orientation classes `1` and
  `3..7` beyond the established class `0` horizontal and class `2`
  upright-English vertical-cell cases;
- terminal-column normalization or internal successor dispatch;
- section and multicolumn frame construction;
- repeated table-header materialization and over-height-row splitting;
- exact wrapper behavior when a line migrates to a frame with another width.

These unresolved terms belong inside `Gamma`, `OwnerAllows`, and the transition
families. They must not be implemented as provenance flags, overflow guards,
or geometry-preservation exceptions.

## 9. Semantic Labels For Binary Evidence

Routine addresses are evidence locators, not terms in the mathematical model.
The following labels are inferred from callers, inputs, outputs, and state
writes. They are intentionally absent from the equations above.

| Evidence locator | Semantic label | Confidence | Reason |
| --- | --- | --- | --- |
| `HwpApp+0x1dd900` | `ResolveLineEndpoint` | high | universal overflow caller; returns the final `(offset,state)` pair and may override the word candidate |
| `HwpApp+0x1dd070` | `SelectWordBreakCandidate` | high | conditional run-mode branch; scans and measures word/hyphen candidates but does not own the final endpoint |
| `HwpApp+0x1dbbf0` | `RequiresWordResolutionAtCursor` | high | nonzero enters word-like candidate resolution; zero remains on the ordinary/control scan; language and source context affect the result |
| `HwpApp+0x590d00` | `MeasureBackwardCursorStep` | high | returns the number of source units to move backward after inspecting Korean/script/control ranges |
| `HwpApp+0x1d75b0` | `MeasureControlAdvance` | high | dispatches control codes selected by `0x00e7d80e` to object vtable slot `+0x14c` and returns zero when unresolved |
| `HwpApp+0x02ff50` | `ResolvePlacementOrientationClass` | high | returns class `0..7`; one path extracts layout-context bits 1..3 after owner and control-kind checks |
| `HwpApp+0x1bb240` | `ShapeControlSelectedPlacementExtent` | high | shared `CHwpTable`/`CHwpShapeObject` slot `+0x14c`; gates on inline participation and placement, then returns placement field `+0x14` or `+0x18` |
| `HwpApp+0x1ea790` | `TablePlacementAt` | high | `CHwpTable` slot `+0x1b0`; returns embedded fragment zero or an additional placement entry |
| `HwpApp+0x1e6d20` | `ZeroControlAdvance` | high | shared by dynamically identified section/column controls and returns zero on every path |
| `HwpApp+0x2d9210` | `ResolveParagraphFlowDirective` | high | decodes the paragraph break byte, adds style page-break-before, masks unavailable axes, and suppresses terminal-column breaks |
| `HwpApp+0x2d6840` | `ComposeFlowOwner` | medium | owns vertical acceptance, owner iteration, directive resolution, rejection, and flow-cursor commit |
| `HwpApp+0x2d9740` | `RejectCurrentFlowPlacement` | medium | reached at the measured vertical boundary before successor-frame layout |
| `HwpApp+0x2dbda0` | `CommitFlowCursor` | high | writes the selected flow position and associated pair after directive/automatic transition |

`ResolveParagraphFlowDirective` is a label for the whole observed effect, not
a claim about Hancom's original stripped symbol. In particular, calling it a
"page-break function" would be wrong: it returns a normalized directive vector
covering section, multicolumn, page, column, and terminal states.

## Evidence

The detailed code map and captures are documented in:

```text
docs/method/hancom-line-layout-findings.md
docs/method/hancom-line-layout-capture.md
docs/hancom-pagination-owner-constraints.md
~/Documents/hancom/captures/20260711-000652-hwpapp-code-level-line-layout/
~/Documents/hancom/captures/20260711-171805-hwpapp-wrapper-predicates/
~/Documents/hancom/captures/20260711-183000-hwpapp-flow-breaks/
~/Documents/hancom/captures/20260711-212601-hwpapp-endpoint-priority/
```
