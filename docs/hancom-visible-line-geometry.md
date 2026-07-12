# Hancom Visible Line Geometry Contract

This document defines what must change in `rhwp_core` to make paragraph edit
geometry follow Hancom semantics.

The important rule is simple: `rhwp_core` needs a first-class visible line
geometry model. Raw paragraph text, saved `line_segs`, browser text wrapping,
and ad-hoc edit heuristics must not be the authority for where visible text
appears.

## Goal

After an edit changes a paragraph and another edit restores the same content
and style state, the paragraph must return to the same visible line geometry.
This must hold for body text, table cells, footnotes, endnotes, aligned
paragraphs, tabs, fields, and treat-as-character objects.

The renderer/editor contract is:

1. Build visible line geometry through one canonical paragraph layout path.
2. Keep source text, logical layout text, and visible paint text separate.
3. Preserve source-to-visible mapping for caret movement and edit operations.
4. Render from canonical visible lines, not from browser/CSS wrapping.
5. Remove paragraph-layout branches that depend on line-geometry origin metadata.

## Current Gap

`rhwp_core` currently has too many places where paragraph geometry can be
decided:

- document line-geometry records;
- fallback/generated line-geometry records;
- `reflow_line_segs` fallback logic;
- renderer-side slicing in `compose_paragraph`;
- layout-side placement in `paragraph_layout`;
- browser replay behavior after layer export;
- edit-time shifting of existing geometry.

That means an edit can accidentally move a paragraph onto a different geometry
path from the one used before the edit. The visible result may then fail to
return to the original state even when the text is restored.

The fix is not to protect saved geometry conditionally. The fix is to make the
canonical visible line output explicit, then make every paragraph container use
that output.

## Required Model

Add a visible line model that represents the final paragraph geometry consumed
by rendering and hit testing.

The model should be independent from line-geometry origin metadata:

```rust
pub struct VisibleParagraph {
    pub lines: Vec<VisibleLine>,
}

pub struct VisibleLine {
    pub source_start: TextPos,
    pub source_end: TextPos,
    pub origin_x: i32,
    pub baseline_y: i32,
    pub width: i32,
    pub height: i32,
    pub fragments: Vec<VisibleFragment>,
}

pub struct VisibleFragment {
    pub source_start: TextPos,
    pub source_end: TextPos,
    pub text: String,
    pub x: i32,
    pub advances: Vec<i32>,
    pub style_id: StyleId,
}
```

The exact field names can change, but the semantics should not:

- `source_*` fields point back to editable document text.
- `text` is the visible paint projection, not necessarily raw paragraph text.
- `origin_x`, `baseline_y`, `width`, `height`, and `advances` are renderer
  inputs, not diagnostics.
- fragments carry style boundaries and special-object boundaries without
  forcing the whole paragraph to take a different layout path.

## Required Pipeline

Paragraph layout should become a staged pipeline:

```text
Paragraph source
  -> logical item stream
  -> visible text projection
  -> line fitting
  -> alignment / justification
  -> VisibleParagraph
  -> render / hit test / export
```

Each stage has a separate responsibility.

`logical item stream` expands paragraph content into text runs, tabs, fields,
controls, footnote/endnote markers, and treat-as-character objects while
preserving source positions.

`visible text projection` converts logical items into the text/fragments that
will actually be painted. It must remove, normalize, or replace logical-only
characters before line fitting. It must also keep a source-to-visible map so
caret movement does not depend on the visible string alone.

`line fitting` decides line breaks from the projected visible items and the
available paragraph frame. The available frame comes from page, column, table
cell, text box, wrap zone, or footnote/endnote area.

`alignment / justification` positions each line and distributes extra space.
This stage must be shared by left, right, center, distributed, and justified
paragraphs.

`render / hit test / export` must consume `VisibleParagraph`. These consumers
should not independently re-slice raw text into lines.

## Code Boundaries

The following code boundaries should move toward the new contract.

`src/renderer/composer.rs`

- `compose_paragraph` should consume `VisibleParagraph` lines.
- `reflow_line_segs` should stop being the compatibility authority.
- Any line-geometry origin branch should be replaced by the same visible-line
  builder.
- Text slicing should use source-to-visible ranges from `VisibleLine`, not
  guessed UTF-16 offsets from whichever `line_seg` is present.

`src/renderer/layout/paragraph_layout.rs`

- Paragraph drawing should place precomputed visible fragments.
- Alignment, first-line indent, line spacing, table-cell frame offsets, and
  wrap-zone offsets should be applied to visible lines in one path.
- Body paragraphs, table cells, footnotes, endnotes, text boxes, and wrapped
  paragraphs should not fork into separate text layout semantics unless the
  document model itself requires a different frame.

`src/document_core/commands/text_editing.rs`

- Edit operations should update source text and invalidate the affected
  paragraph's visible layout.
- They should not preserve, patch, or shift visible geometry as an independent
  semantic source.
- Insert/delete round trips should be tested by comparing regenerated visible
  lines after the source returns to its previous state.

`src/document_core/queries/cursor_rect.rs`

- Caret rectangles should be derived from `VisibleParagraph` source-to-visible
  mapping and fragment advances.
- Cursor movement must not depend on raw text width when logical characters are
  hidden, normalized, or represented by controls.

`src/renderer/layout/text_measurement.rs`

- Measurement must report advances for visible fragments in the same unit basis
  used by visible lines.
- Font ratio, spacing, synthetic style, mixed font fallback, and control
  replacement widths should enter here, before line fitting.

`src/wasm_api.rs`

- The browser-facing export should expose enough visible-line data for the
  frontend to replay the canonical geometry.
- The browser must not use CSS wrapping or canvas measurement to decide line
  breaks after the core has produced visible lines.

## Invariants

- Imported `line_segs` may seed metrics, but they are not a separate behavior
  mode.
- Generated `line_segs` may exist as compatibility storage, but they are not a
  separate behavior mode.
- A paragraph has one canonical visible-line result for a given document state,
  style state, and frame.
- Edit idempotence is checked on visible lines, not only on paragraph text.
- Table cells, footnotes, endnotes, and body paragraphs share the same visible
  line contract; only their containing frame differs.
- Tabs, fields, control markers, footnote/endnote markers, and
  treat-as-character objects are logical items that project into visible
  fragments or occupied boxes.
- Rendering and hit testing consume the same visible line data.

## Migration Plan

1. Introduce `VisibleParagraph`, `VisibleLine`, and `VisibleFragment` behind an
   internal API.
2. Add a builder that converts one paragraph plus frame/style context into a
   `VisibleParagraph`.
3. Make the builder consume existing `line_segs` only as input facts, not as a
   provenance branch.
4. Move `compose_paragraph` onto `VisibleParagraph` while preserving old layer
   output shape.
5. Move cursor rectangle queries onto the same visible-line data.
6. Replace edit-time geometry shifting with invalidation plus canonical rebuild.
7. Extend export so WASM/browser replay receives the same visible-line
   geometry.
8. Delete fallback branches that reflow only when geometry is missing,
   synthetic, stored, imported, or overflowing.

## Test Contract

Tests should compare visible line geometry before/after edit cycles.

The minimum fixture matrix:

- plain body paragraph;
- left, right, center, justify, and distributed alignment;
- table cell paragraph;
- footnote paragraph;
- endnote paragraph;
- paragraph with tab;
- paragraph with field/control marker;
- paragraph with treat-as-character object;
- mixed char style and font ratio/spacing;
- edit that inserts text, then deletes it back to the original source;
- edit that changes source enough to create a real new line, then restores it.

Each test should assert:

- visible line count;
- visible text projection per line;
- line origin/baseline;
- fragment advances or width;
- caret positions around the edited range;
- byte/UTF-16 source mapping for the visible fragments.

Tests should not pass by checking only raw paragraph text.

## Non-Goals

- Do not add a browser-side wrapping fallback.
- Do not add a stored-vs-generated geometry branch.
- Do not make `line_segs` provenance part of layout semantics.
- Do not treat tables, footnotes, or endnotes as special text engines unless
  the only difference is their containing frame.
- Do not solve glyph-outline replay here; this contract is about visible line
  geometry and edit stability.
