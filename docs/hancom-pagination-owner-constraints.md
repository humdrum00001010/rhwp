# Hancom Pagination And Owner Constraints

This document extends `hancom-line-break-model.md` with the vertical and owner
relations that select a flow frame. It defines one canonical layout path. No
term depends on whether geometry was stored, imported, generated, or edited.

## 1. Evidence Levels

Claims are marked as follows:

- **Dynamic**: paired native executions exposed the stated inputs and outputs.
- **Static**: the relation is recovered from the native control flow.
- **Format**: the value is defined by HWPX and preserved by Hancom.
- **Open**: the current evidence does not uniquely determine the relation.

An open relation remains a parameter of the model. It must not be replaced by
an overflow heuristic or a geometry-preservation branch.

## 2. Flow Frames And Owners

Let the ordered flow-frame family be:

```text
F_m = (p_m, c_m, o_m, Y_m, H_m, Omega_m, K_m)
```

where:

- `p_m` and `c_m` are page-family and column-family coordinates;
- `o_m` is the owner identity;
- `[Y_m, Y_m + H_m)` is the usable vertical interval;
- `Omega_m(y)` is the ordered horizontal-slot set at height `y`;
- `K_m` is the owner and pagination constraint state.

Owners form a rooted ordered tree:

```text
body
  |- header/footer owner
  |- table fragment
  |    `- cell text owner
  |- floating/text object owner
  `- note owner
```

This is a flow relation, not a paint hierarchy. A nested owner can reserve
space from an ancestor and can have a different `Omega_m`, `H_m`, and
constraint state.

For paragraph `a`, let:

```text
n(a) = total formatted line count
q(a,m) = line prefix vertically accepted in F_m before paragraph constraints
```

The unconstrained prefix is the largest `q` satisfying:

```text
sum(0 <= j < q) V(L_j) <= H_eff(F_m,a)
```

where `V(L_j)` is the vertical extent of line `j` and `H_eff` includes owner
reservations.

## 3. Paragraph Owner Constraints

The native paragraph record uses these flags in the placement-rejection path:

```text
0x10000  widow/orphan
0x20000  keep with next
0x40000  keep lines
```

These flags transform the candidate prefix before the flow cursor is
committed.

### 3.1 Keep Lines

For a paragraph with `KeepLines(a)`:

```text
C_keep_lines(a,q,n) =
  0  if 0 < q < n
  q  otherwise
```

**Static:** the `0x40000` branch changes every nonzero partial accepted count
to zero.

**Dynamic:** with identical `verticalLimit=72844`, a candidate
`acceptedLines=1` committed `acceptedLines=0`; the baseline retained the
single line.

### 3.2 Widow And Orphan

For `WidowOrphan(a)` and a partial candidate `0 < q < n`:

```text
C_widow(a,q,n) =
  0      if n < 4
  0      if q = 1
  q - 1  if n >= 4 and q > 1 and the predecessor-line boundary is admissible
  q      otherwise
```

The `q - 1` branch leaves at least two lines in the successor frame. The
`q = 1` branch prevents a single line from remaining in the current frame.

**Static:** these are the exact comparisons and count update in the `0x10000`
branch.

**Dynamic:** the paired baseline and widow/orphan fixtures both reached
`acceptedLines=1`, `verticalLimit=72844`; only widow/orphan committed zero.

### 3.3 Keep With Next

Let `a_0,...,a_r` be a maximal paragraph chain such that:

```text
KeepWithNext(a_i) = true, 0 <= i < r
successor(a_i) = a_(i+1)
```

If `a_r` admits no line in the current frame, chain placement rewinds to its
start:

```text
C_keep_next((a_0,...,a_r), q(a_r,m)=0) = (a_0,0)
```

**Static:** the `0x20000` branch walks the linked successor chain and commits
line zero at the chain boundary.

**Dynamic:** an alternating constrained/unconstrained fixture reached
`a_r=0x1ef0f138`, `acceptedLines=0` and committed
`(a_0=0x1ef0e898, acceptedLines=0)`. The changed paragraph pointer proves a
chain rewind, not merely a zero-count update on the rejected paragraph.

### 3.4 Constraint Composition

The paragraph transform is not an independent reflow mode. It is applied to
the candidate prefix in the current frame:

```text
q' = C_owner(a,q,n,K_m)
```

If `q'=0`, the ordinary successor-frame relation runs and horizontal layout is
resolved in the successor frame's slots.

## 4. Page And Column Directives

The normalized native values are:

```text
0x200  page-family directive
0x400  column-family directive
```

In a two-column native document, the observed column-family relation includes:

```text
D(a)=0x400 at c_m=0, frame_count=2
commit(a)
next body composition at c_(m+1)=1
```

This dynamically proves the nonterminal successor:

```text
T_column(F_(p,0,o)) = F_(p,1,o)
```

The same document returned `0x400` with the captured state field equal to
column `1`, and returned `0x200` from column `1`. Therefore a model that simply
drops every terminal-column `0x400` before dispatch is inconsistent with the
dynamic trace.

The exact terminal-column equation remains **Open** because the capture does
not yet distinguish these possibilities at the directive boundary:

```text
T_column(F_(p,C-1,o)) = F_(p+1,0,o)
```

or:

```text
Normalize(0x400,F_(p,C-1,o)) = 0x200
```

or a column-family dispatch that internally selects the next page owner.

The canonical API must therefore expose a frame-successor relation, not encode
"column break means column index plus one" in paragraph layout.

## 5. Notes, Headers, And Footers

For notes anchored in frame `F_m`, define:

```text
rho(N_m,S) = note lines + separator + note margins + note spacing
H_eff(F_m,N_m) = H_m - rho(N_m,S)
```

The body acceptance relation is:

```text
y + V(L) <= Y_m + H_eff(F_m,N_m)
```

**Dynamic:** one footnote fixture produced a nested note owner with:

```text
body limit      = 65762
note limit      = 63345
note line used  = 900
reservation     = 2417
```

`2417` is fixture-specific. It is not a constant.

**Static:** owner construction dispatches header, footer, footnote, section,
and page-control kinds through the same page-owner construction region. Thus
header/footer geometry belongs to frame construction:

```text
F_page = ConstructPageOwner(section, header, footer, notes, page_style)
```

The exact header/footer height and first/even/odd-page selection functions are
**Open**. They must remain inputs to `ConstructPageOwner`, not overlays applied
after body pagination.

## 6. Table Owners

Let table `t` have ordered row set `R(t)`. A paginated table produces ordered
fragments:

```text
T(t) = (T^0, T^1, ..., T^s)
Rows(T^0) || Rows(T^1) || ... || Rows(T^s) = R(t)
```

up to repeated presentation rows. Every fragment owns cell frames:

```text
CellFrame(t,r,c,m) = (owner=(t,r,c), H_cell, Omega_cell, K_cell)
```

The native 84-row fixture has:

```text
pageBreak=CELL
repeatHeader=1
rowCnt=84
noAdjust=1
```

**Dynamic:** initial composition produced six nonzero outer-owner continuation
states (`transitionState=2`) from the same table owner. Between those events,
distinct nested owners composed the cell paragraphs. This proves:

```text
table pagination = outer table-fragment transition
                 + nested cell-owner composition
```

It is not ordinary body-paragraph overflow and must not be represented by
clipping cell text.

**Format:** the first row is marked as a header and `repeatHeader=1`.

The exact repeated-header materialization relation is still **Open**:

```text
PresentationRows(T^j) = HeaderRows(t) || Rows(T^j), j > 0
```

has not yet been isolated from initial table composition at a code boundary.
RHWP must keep `HeaderRows(t)` and the repeat policy in table-owner state until
that boundary is recovered.

## 7. Canonical Pagination Recurrence

Let the layout state before a candidate line be:

```text
X_k = (b_k, F_m, y_k, owner_stack_k, note_state_k, directive_state_k)
```

For the current frame:

```text
omega_k = SelectSlot(Omega_m(y_k))
e_k     = ResolveEndpoint(b_k,omega_k,F_m,S)
L_k     = D[b_k,e_k)
q_k     = VerticalPrefix(F_m,L_k,H_eff)
q'_k    = C_owner(paragraph(b_k),q_k,n,K_m)
```

A line-position rewind is a frame transition only when its source frame is the
current frame. For a paragraph whose first line is `L_0` and candidate rewind
line is `L_r`:

```text
SourceFrameMatches(F_m,a) := y(L_0) <= y_k + spacing_before(a) + epsilon_HU

RewindToSuccessor(F_m,L_r) :=
  SourceFrameMatches(F_m,a)
  and y(L_(r-1)) + V(L_(r-1)) >= 0.72 H(F_m)
  and y(L_r) <= 0.06 H(F_m)
  and y(L_r) < y(L_(r-1))
```

`epsilon_HU` is only the HWPUNIT-to-pixel quantization bound. It is not an
overflow allowance. This source-frame predicate prevents a rewind belonging
to an earlier frame from advancing the current flow a second time.

Acceptance is:

```text
Accept(X_k,L_k) :=
  FitsSlot(omega_k,L_k)
  and q'_k > 0
  and OwnerAllows(o_m,L_k,K_m)
  and DirectiveAllows(F_m,directive_state_k)
```

If accepted, commit the selected source cursor and vertical successor. If
rejected, select a successor frame and resolve horizontal geometry again:

```text
F_r = min_< {F | F_m < F and FrameAllows(F,L_k,K_F)}
X'_k = (b_k,F_r,Y_r,owner_stack_r,note_state_r,directive_state_r)
e'_k = ResolveEndpoint(b_k,SelectSlot(Omega_r(Y_r)),F_r,S)
```

The recomputation is canonical because `Omega_r` is an input to endpoint
selection. It is not a fallback from one geometry source to another.

For reversible edit `E`:

```text
E^-1(E(D)) = D
  =>
Phi_Hancom^*(D,S,F) = Phi_Hancom^*(E^-1(E(D)),S,F)
```

## 8. RHWP Representation Requirements

RHWP can express this model only if its canonical objects carry:

1. ordered flow-frame identity `(page,column,owner)`;
2. owner nesting and owner-specific slot geometry;
3. paragraph total-line and candidate-prefix counts;
4. widow/orphan, keep-lines, and keep-with-next flags in placement state;
5. paragraph-chain boundaries for rewind;
6. page/column directive state and a frame-successor relation;
7. note reservation before body acceptance;
8. table fragment identity, cell owner identity, header-row set, and repeat
   policy;
9. endpoint recomputation whenever the selected successor has another slot.
10. the source-frame positional index needed to decide whether a line rewind
    belongs to the current frame.

There must be no `stored`, `imported`, `generated`, `edited`, or
`geometry_source` discriminator in these equations.

## 9. Remaining Unknowns

The following are not yet canonicalized:

- terminal-column `0x400` normalization versus internal successor dispatch;
- section and multicolumn geometry construction;
- first/even/odd header and footer owner selection and exact reservations;
- repeated table-header materialization and row-span behavior across a page;
- row splitting when one logical row is taller than the available frame;
- exact owner predicates for floating text objects at a page boundary;
- endpoint behavior when successor-frame width differs from current width.
- the line-local font-matrix closure needed to construct endpoints when a
  paragraph has no committed endpoint partition. Pagination cannot infer this
  from a rewind or from file provenance.

These are research targets. None authorizes a heuristic implementation.

## 10. Evidence Map

The preserved research set is:

```text
~/Documents/hancom/captures/20260712-015930-hwpapp-pagination-owner-constraints/
```

Key files:

```text
raw/transition-baseline.log
raw/transition-widow-orphan.log
raw/transition-keep-lines.log
raw/transition-keep-with-next-chain.log
raw/transition-multicolumn-axis.log
raw/transition-table-rowbreak.log
static/decompile-102d9740.txt
static/decompile-102db140.txt
tools/trace_owner_transitions.js
tools/trace_table_owner.js
fixtures/owner-keep-with-next-chain.hwpx
```
