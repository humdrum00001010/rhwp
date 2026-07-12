# Hancom Geometry Frida Notes

Date: 2026-07-08

## Scope

This note records observed Hancom process behavior for the paragraph geometry
edit bug. It does not claim Hancom line-break or font-matrix semantics yet; the
current driver attempts did not reach an active editable Hancom document
surface.

## Deleted rhwp-side fallback

Removed the rhwp-side model that meant:

```text
keep previous/snapshot line geometry unless the edited paragraph overflows,
otherwise reflow with rhwp
```

That model is not Hancom semantics. The remaining edit path should not branch
on "snapshot/stored/imported" provenance or on a saved-geometry overflow guard.

Focused cleanup verification:

```sh
rg -n "line_geometry_snapshots|ParagraphLineGeometrySnapshot|LineGeometryKey|paragraph_needs_generated_line_geometry|footnote_paragraph_needs_generated_line_geometry|paragraph_line_geometry_overflows|footnote_paragraph_line_geometry_overflows|capture_line_geometry_snapshot|restore_.*line_geometry|overflows_saved_geometry|has_pending_snapshot|needs_generated_geometry|keep saved|saved geometry|unless it overflows|otherwise reflow" src/document_core src/renderer tests
```

Result: no matches.

## Frida target state

Frida server:

```sh
frida-ps -H 127.0.0.1:27042
```

Visible Hancom processes during this pass:

```text
880   Hwp.exe
9632  Hwp.exe
1232  Hwp.exe
```

Window probe result:

```text
foreground pid=3372, image=frida-server.exe
```

Each Hwp process has a visible top-level `HwndWrapper[...]` window titled with
Hancom's private-use app glyph, but the document edit child observed by Frida is
hidden:

```text
className=HwpMainEditWnd, visible=false
```

Examples:

```text
pid=880  HwpMainEditWnd hwnd=0x1404a2 visible=false
pid=9632 HwpMainEditWnd hwnd=0x6804e4 visible=false
pid=1232 HwpMainEditWnd hwnd=0x105d4 visible=false
```

This explains why the first keyboard driver was misleading: WScript
`AppActivate(880)` returned true once, but the foreground window observed from
Frida was not Hancom and no Hancom caret/focus was present.

## Hook attempts

### HncDrawingEngine.dll text composition hooks

Script: `tools/hancom_text_shape_trace.js`

Installed hooks:

```text
LayoutFactory::CreateHSpace
LayoutFactory::CreateSpaces
LayoutFactory::CreateHGlue
LayoutFactory::CreateHNatural
LayoutFactory::CreateHFix
LayoutFactory::CreateHVariable
Composition::CreateLineItem
LRComposition::CreateLineItem
SimpleCompositor::ComposeBreak
SimpleCompositor::ComposeLayout
```

Result: hooks installed on `880`, `9632`, and `1232`; no events fired during the
attempted edit trigger.

### TextShaping.dll hooks

Script: `tools/hancom_textshaping_trace.js`

Installed hooks:

```text
ShapingGetGlyphs
ShapingGetGlyphPositions
ShapingGetBreakingProperties
ShapingDrawGlyphs
ShapingCreateFontCacheData
```

Result: hooks installed on `880`, `9632`, and `1232`; no events fired during the
attempted edit trigger.

### In-process activation/input driver

Script: `tools/hancom_textshaping_type_trace.js`

Observed against `pid=9632`:

```text
candidate_window hwnd=0x404f6 className=HwndWrapper[...] text=<Hancom app glyph>
edit_window hwnd=0x6804e4 visible=false className=HwpMainEditWnd
SetForegroundWindow returned 0
PostMessageW(WM_CHAR/VK_BACK) returned 1 for HwpMainEditWnd and top window
```

Result: the messages were accepted into the queue, but no TextShaping hook
events fired. Treat this as a failed driver, not as Hancom layout evidence.

## Export map worth pursuing

### HncBidiEngine.dll

Relevant exports observed:

```text
BidiLineBreaker::BidiLineBreaker(BidiPara*, wchar_t*, int)
BidiLineBreaker::GetNextLine(int, BidiLine&)
BidiLineBreaker::ComposeLine(int, int, BidiLine&)
BidiLine::SetCharBounds(int, int)
BidiLine::GetWidth(bool)
BidiLine::GetFromCharPos()
BidiLine::GetToCharPos()
BidiLineSegment::GetWidth()
BidiFontMetrics::GetAscent()
BidiFontMetrics::GetDescent()
StyleRun::StyleRun(int, int, LOGFONTW&, wchar_t*)
```

These look closer to paragraph line geometry than GDI draw hooks.

### HncDrawingEngine.dll

Relevant exports observed:

```text
LayoutFactory::CreateHSpace(float)
LayoutFactory::CreateSpaces(...)
LayoutFactory::CreateHGlue(float, float, float, float, int)
LayoutFactory::CreateHNatural(glyph, float)
LayoutFactory::CreateHFix(glyph, float)
LayoutFactory::CreateHVariable(glyph, float, float)
Composition::CreateLineItem(Break&, int, int)
LRComposition::CreateLineItem(Break&, int, int)
SimpleCompositor::ComposeBreak(...)
SimpleCompositor::ComposeLayout(...)
```

These are likely where space/glue/natural/fixed/variable advances enter the
composition model, but they did not fire without a real active document driver.

### TextShaping.dll

Relevant exports observed:

```text
ShapingGetGlyphs
ShapingGetGlyphPositions
ShapingGetBreakingProperties
ShapingDrawGlyphs
ShapingCreateFontCacheData
```

These are lower-level glyph shaping hooks. They are useful once the active
document path is reached, but silence during this pass only proves the driver
did not exercise shaping.

## Next required driver

Before deriving geometry rules, establish a real interactive Hancom document
surface:

1. Open the target document in session 1 and verify the active document window
   title matches the target, not an autosave/blank hidden window.
2. Verify `GetGUIThreadInfo` reports a Hancom `hwndFocus` or caret, not
   `frida-server.exe`.
3. Only then run the Bidi/Drawing/TextShaping hooks while performing the
   reversible edit.
4. Record line-level values from `BidiLineBreaker::GetNextLine`,
   `ComposeLine`, `SetCharBounds`, and width getters before mapping rhwp.

Until those conditions are met, any inferred line-break or font-matrix rule is
not sourced from Hancom.

## 2026-07-09 active-window capture pass

Frida server was reachable:

```sh
frida-ps -H 127.0.0.1:27042
```

Visible Hancom processes:

```text
880    Hwp.exe
9632   Hwp.exe
1232   Hwp.exe
10364  Hwp.exe
```

Window probe found `10364` as the usable live edit target:

```json
{"pid":10364,"className":"HwndWrapper[Hwp.exe;;...]","text":"빈 문서 1 - 한글","visible":true}
{"pid":10364,"className":"HwpMainEditWnd","hwnd":"0xb0664","visible":true}
{"pid":10364,"arch":"ia32","pointerSize":4}
```

The other `Hwp.exe` instances still had hidden `HwpMainEditWnd` children, so
they were not useful for live input capture.

### What worked

Script:

```text
tools/hancom_geometry_live_capture.js
```

Installed hooks:

```text
HncBidiEngine.dll:
  BidiLineBreaker::ctor
  BidiLineBreaker::GetNextLine
  BidiLineBreaker::ComposeLine

HncDrawingEngine.dll:
  LayoutFactory::CreateHSpace/CreateSpaces/CreateHGlue
  LayoutFactory::CreateHNatural/CreateHFix/CreateHVariable
  Composition::CreateLineItem / LRComposition::CreateLineItem
  SimpleCompositor::ComposeBreak/ComposeLayout

gdi32.dll:
  ExtTextOutW
  GetTextExtentExPointW
```

Direct `WM_CHAR` posting to the visible `HwpMainEditWnd` plus
`InvalidateRect/UpdateWindow` produced real Hancom draw callbacks through
`ExtTextOutW`. Example line draw evidence:

```json
{"api":"ExtTextOutW","x":166,"y":192,"options":0,"count":21,"dxSum":676,"dx":[16,70,16,70,16,16,18,17,51,16,60,17,43,33,25,25,33,16,93,16,9],"worldTransform":[1,0,0,1,0,0]}
{"api":"ExtTextOutW","x":157,"y":218,"options":0,"count":25,"dxSum":708,"dx":[16,61,16,16,43,16,19,16,70,16,16,19,16,41,16,44,16,44,16,33,16,85,25,16,16],"worldTransform":[1,0,0,1,0,0]}
{"api":"ExtTextOutW","x":199,"y":245,"options":0,"count":20,"dxSum":666,"dx":[16,26,58,16,44,16,50,16,62,17,41,17,42,16,16,20,17,72,88,16],"worldTransform":[1,0,0,1,0,0]}
{"api":"ExtTextOutW","x":157,"y":272,"options":0,"count":25,"dxSum":692,"dx":[40,17,43,17,67,16,16,39,25,16,61,17,66,16,16,27,16,25,17,16,19,16,51,17,16],"worldTransform":[1,0,0,1,0,0]}
{"api":"ExtTextOutW","x":173,"y":298,"options":0,"count":7,"dxSum":209,"dx":[44,16,16,31,70,16,16],"worldTransform":[1,0,0,1,0,0]}
```

Each line also appeared with `options=4096`, same `x/y/count/dx`, which looks
like a second pass over the same line draw.

This proves we can now capture Hancom's final GDI draw geometry from the active
edit surface. It also proves Hancom is doing actual line breaks in this path:
the sample was drawn over five baselines (`y=192,218,245,272,298`) with
per-line x offsets.

### What did not work

The direct `WM_CHAR` path corrupts the Korean text before Hancom lays it out.
The captured `ExtTextOutW.text` is mojibake-like Hangul, not the original
Korean sample. Therefore this capture is valid for final draw geometry
(`x/y/dx`) but not valid for mapping semantic character offsets or exact text
break positions.

Other input drivers failed:

```text
SendInput from inside Hwp.exe:
  Process.arch=ia32, pointerSize=4
  20-byte INPUT layout used
  SendInput returned 0, GetLastError returned 0 for Ctrl+A/Backspace/Unicode text

WM_PASTE to HwpMainEditWnd:
  PostMessageW(WM_PASTE) returned 1
  No Bidi/Drawing/GDI callbacks followed

SSH wqemu SendKeys:
  AppActivate(10364): Process not found
  SendWait: Access is denied

HWPFrame.HwpObject COM automation from ssh:
  New-Object -ComObject HWPFrame.HwpObject hung for >30s; aborted
```

Hooks that stayed silent during the active edit draw:

```text
HncBidiEngine::BidiLineBreaker*
HncDrawingEngine::LayoutFactory / Composition / SimpleCompositor
TextShaping.dll shaping exports (earlier pass)
```

Current conclusion: Frida access is working and final GDI draw metrics are
capturable from Hancom. The missing piece is a reliable Unicode input/control
driver that reaches Hancom's normal editable document path. Until that exists,
the captured dx/y values should not be used as canonical text line-break
semantics for rhwp_core.

## 2026-07-09 user-driven passive capture pass

Target:

```text
Hwp.exe pid=488
Frida endpoint: 127.0.0.1:27042
Script: tools/hancom_geometry_passive_capture.js
Log: tmp/hancom_geometry_passive_488.log
```

The script stayed attached while the document was edited through the GUI. The
capture reached its 2000 event cap. Event breakdown:

```text
706 TextShaping::ShapingGetGlyphs
705 TextShaping::ShapingGetGlyphPositions
393 ExtTextOutW
196 TextShaping::ShapingDrawGlyphs
```

Installed but silent in this pass:

```text
BidiLineBreaker::ctor / GetNextLine / ComposeLine
LayoutFactory::CreateHSpace/CreateSpaces/CreateHGlue/CreateHNatural/CreateHFix/CreateHVariable
Composition::CreateLineItem / LRComposition::CreateLineItem
SimpleCompositor::ComposeBreak/ComposeLayout
GetTextExtentExPointW
```

So this pass is a final draw/shaping trace, not a full paragraph layout trace.
The table edits the user performed are not visible as table-specific layout
records because the cap was consumed by redraw/shaping traffic.

Useful GDI evidence from the pass:

```text
ExtTextOutW text="범용용역지식ㆍ정보성과물업 분야표준하도급계약서 "
  x=195 y=154 count=25 dxSum=644/646
  dx=25,33,25,33,25,25,25,25,25,25,25,33,25,13,25,45,25,25,25,25,25,25,25,25,12|14

ExtTextOutW text="범용용역지식ㆍ정보성과물업 분야"
  x=170 y=113/147/154 count=16 dxSum=411/412
  dx=25,32,25,33,25,25,25,25,25,25,25,33,25,13,25,25|26

ExtTextOutW text="표준하도급계약서 "
  x=131 y=181 or x=430/436 y=147/188 count=9 dxSum=212/214
  dx=25,25,25,25,25,25,25,25,12|14
```

Interpretation:

- Hancom's final paint stage exposes explicit line runs with per-glyph advances.
  The same logical title can appear either as one 25-character draw run or as
  two line-run draws (`... 분야` then `표준하도급계약서 `), depending on the
  current layout state.
- The `options=0` and `options=4096` pairs are repeated draw passes over the
  same text. The last advance usually differs by one or two pixels between the
  two passes.
- This is enough to prove the browser-side implementation must preserve
  Hancom's emitted line-run geometry and per-run advances. It is not enough to
  derive the paragraph-breaking algorithm, table layout algorithm, or semantic
  char-offset mapping.

Next capture requirements:

1. Raise or remove the event cap, or split capture by phase so text shaping
   cannot starve layout records.
2. Run a low-noise pass that logs only `ExtTextOutW` line runs and maybe window
   messages while the user performs table edits.
3. Run a separate layout pass focused on `HncDrawingEngine` and
   `HncBidiEngine`, without TextShaping/GDI noise, to see whether those symbols
   fire during real GUI edits or whether Hancom uses a different layout path for
   this document.

## 2026-07-09 focused user edit capture

Target:

```text
Hwp.exe pid=488
Frida endpoint: 127.0.0.1:27042
Script: tools/hancom_geometry_layout_gdi_capture.js
Log: tmp/hancom_geometry_layout_gdi_488_edit_ko_20260709-015440.log
```

This pass removed TextShaping hooks and filtered GDI records to Korean text so
the user's edit would not be drowned by shaping noise. The script also kept the
`HncBidiEngine` and `HncDrawingEngine` layout hooks installed.

Event breakdown:

```text
5426 ExtTextOutW
21   capture_heartbeat
1    layout_gdi_capture_ready
```

No layout-hook records fired:

```text
0 BidiLineBreaker::ctor / GetNextLine / ComposeLine / SetCharBounds
0 LayoutFactory::CreateHSpace/CreateSpaces/CreateHGlue/CreateHNatural/CreateHFix/CreateHVariable
0 Composition::CreateLineItem / LRComposition::CreateLineItem
0 SimpleCompositor::ComposeBreak/ComposeLayout
0 GetTextExtentExPointW
```

Representative edit-local runs:

```text
n=55  x=102 y=-49 count=6 dxSum=98  text="이ㅏ프미ㅏ프"
n=56  x=102 y=-49 count=6 dxSum=99  text="이ㅏ프미ㅏ프" options=4096
n=65  x=102 y=-25 count=6 dxSum=98  text="이ㅏ프미ㅏ프"
n=66  x=102 y=-25 count=6 dxSum=99  text="이ㅏ프미ㅏ프" options=4096
n=81  x=102 y=23  count=6 dxSum=98  text="이ㅏ프미ㅏ프"
n=82  x=102 y=23  count=6 dxSum=99  text="이ㅏ프미ㅏ프" options=4096
```

Representative document/table-like form runs:

```text
n=7   x=207 y=38  count=23 dxSum=341/342 text="하도급대금 연동 계약서 또는 미연동 계약서"
n=9   x=60  y=68  count=8  dxSum=84      text="첨 부     "
n=11  x=207 y=68  count=13 dxSum=196/197 text="기타 서류개별 약정서 등"
n=5371 x=79 y=618 count=36 dxSum=507/508 text="이고 원칙적인 사항만을 제시하였는바실제 하도급계약을 체결하려는 계"
n=5383 x=209 y=641 count=24 dxSum=293/294 text="약서의 기본 틀과 내용을 유지하는 범위에서 "
n=5423 x=403 y=757 count=19 dxSum=241/242 text="수정 또는 변경하여 사용할 수 있습"
```

Interpretation:

- In a real user-driven edit, Hancom still exposes stable final line-run paint
  geometry through `ExtTextOutW`.
- The normal visible edit path did not execute the currently hooked
  `HncBidiEngine`/`HncDrawingEngine` exports. Either these are not the hot
  layout path for this document/edit surface, or the exported functions are too
  high-level/old-path and the real path is elsewhere.
- The immediate next reverse-engineering step should be caller tracing from
  `ExtTextOutW`/GDI paint records back into Hancom modules, rather than adding
  more rhwp_core heuristics or continuing to assume the hooked Bidi/Drawing
  exports are canonical.

## 2026-07-09 `ExtTextOutW` caller/backtrace capture

Target:

```text
Hwp.exe pid=488
Frida endpoint: 127.0.0.1:27042
Script: tools/hancom_exttextout_backtrace_capture.js
Log: tmp/hancom_exttextout_backtrace_488_edit_20260709-020607.log
```

Event breakdown:

```text
4574 ExtTextOutW
396  backtrace
58   capture_heartbeat
1    exttextout_backtrace_capture_ready
```

Main finding:

- Hancom paints each Korean visible line-run twice.
- The first run uses `options=0` and has one stable stack:

```text
btId=1
HncBaseDraw.dll+0x4c6ca  CHncDuoDC::ExtTextOutW
GDI32.dll+0x2050        ExtTextOutW
HncBaseDraw.dll+0x5d775 HncDRCtxEndPage
HncBaseDraw.dll+0x4fe14 CheckDuoForMFC
HncBaseDraw.dll+0x4ffbc CheckDuoForMFC
HncBaseDraw.dll+0x5165c CheckDuoForMFC
HncBaseDraw.dll+0x4d9d8 CheckDuoForMFC
HncBaseDraw.dll+0x4d723 CheckDuoForMFC
HwpApp.dll+0x30c481
HwpApp.dll+0x17eb79
HwpApp.dll+0x17f828
HwpApp.dll+0x189ab5
HwpApp.dll+0x189486
HwpApp.dll+0x18926c
HwpApp.dll+0x18917c
HwpApp.dll+0x188911
```

- The second run uses `options=4096` and goes through
  `TextShaping.dll+0x5e384 ShapingDrawGlyphs`; unwind quality loses the
  upstream Hancom frames there, so it is the shaped replay rather than the
  semantic layout owner.
- A third `options=16` stream repeatedly emitted `ㅍ\u0001` control-like runs.
  Treat it as non-body/text-control drawing until proven otherwise.

Representative edited runs from the user pass:

```text
x=51  y=281 count=57 dxSum=761 text="하기로 약정한 경우에 기재하며그 원재                 ㅏㅡ니라ㅣ료를 여러 번에 걸쳐 공급하"
x=52  y=115 count=51 dxSum=769 text="계약체결 전에 받은 경우에는 계약체결일부터 일 이내 선급금의 내      ㅣㅏ늘이ㅏ은ㄹ용과 "
x=514 y=320 count=7  dxSum=133 text="ㅁ아ㅣ므이파ㄴ"
x=153 y=248 count=5  dxSum=83  text="ㅁ아림라ㅢ"
x=614 y=360 count=2  dxSum=32  text="개정"
```

Interpretation:

- The line-run oracle we need is above GDI and above `TextShaping`:
  `HncBaseDraw::CHncDuoDC::ExtTextOutW` receives already-decided `(x, y,
  text, dx[])` fragments.
- The exported `HncBidiEngine` and the previously selected `HncDrawingEngine`
  text composer exports still did not fire during the GUI edit. Either HWP body
  text is laid out in `HwpApp.dll`, or these exports are only for a shape/textbox
  engine path.
- Next active hook should be `HncBaseDraw.dll`'s own exported wrappers, not
  `gdi32.dll!ExtTextOutW`, so the stack begins at the Hancom wrapper and should
  preserve the direct HwpApp return address:

```text
?ExtTextOutW@CHncDuoDC@@UAEHHHIPBUtagRECT@@PBGIPBH@Z       offset 0x4c6a0
?ExtTextOutW@CHncDrawContext@@QAEHHHIPBUtagRECT@@PBGIPBH@Z offset 0x61d40
?ExtTextOutW@@YGHPAVCHncDeviceContext@@HHIPBUtagRECT@@PBGIPBH@Z offset 0x2f830
?HncDRCtxBeginPage@@YGHH@Z offset 0x5abb0
?HncDRCtxEndPage@@YGHH@Z   offset 0x5abe0
```

Prepared follow-up capture:

```text
Script: tools/hancom_duodc_text_trace.js
Live log: tmp/hancom_duodc_text_trace_488_edit_20260709-021710.log
Status: attached, idle, writes JSONL correctly
```

## 2026-07-09 `CHncDrawContext` / `CHncDuoDC` edit capture

Target:

```text
Hwp.exe pid=488
Frida endpoint: 127.0.0.1:27042
Script: tools/hancom_duodc_text_trace.js
Log: tmp/hancom_duodc_text_trace_488_edit_20260709-021710.log
```

Event breakdown after the user edit:

```text
787 CHncDrawContext::ExtTextOutW
787 CHncDuoDC::ExtTextOutW
105 capture_heartbeat
26  backtrace
1   duodc_text_trace_ready
```

Stable wrapper stacks:

```text
CHncDrawContext::ExtTextOutW:
  HwpApp.dll+0x30c481
  HncBaseDraw.dll+0x61d40 CHncDrawContext::ExtTextOutW
  HwpApp.dll+0x17eb79
  HwpApp.dll+0x17f828
  HwpApp.dll+0x189ab5
  HwpApp.dll+0x189486
  HwpApp.dll+0x18926c
  HwpApp.dll+0x18917c
  HwpApp.dll+0x188911
  HwpApp.dll+0x17dbcc
  HwpApp.dll+0x17d7d5
  HwpApp.dll+0x113827
  HwpViewUI.dll+0x15b9d
  HwpViewUI.dll+0x131e6
  HwpViewUI.dll+0x1819d

CHncDuoDC::ExtTextOutW:
  HncBaseDraw.dll+0x5d775 HncDRCtxEndPage
  HncBaseDraw.dll+0x4c6a0 CHncDuoDC::ExtTextOutW
  HncBaseDraw.dll+0x4fe14 CheckDuoForMFC
  HncBaseDraw.dll+0x4ffbc CheckDuoForMFC
  HncBaseDraw.dll+0x5165c CheckDuoForMFC
  HncBaseDraw.dll+0x4d9d8 CheckDuoForMFC
  HncBaseDraw.dll+0x4d723 CheckDuoForMFC
  HwpApp.dll+0x30c481 or HwpApp.dll+0x30c2e6
  HwpApp.dll+0x17eb79 ...
```

Observed pair semantics:

- `CHncDrawContext::ExtTextOutW` is the logical/document-space text stream.
  It includes large coordinate/advance values and invisible Hangul filler code
  points such as U+115F/U+1173/U+11BC in the captured edit strings.
- `CHncDuoDC::ExtTextOutW` is the normalized visible line-run stream after
  Hancom filtering and coordinate conversion. It removes many raw stream
  characters and exposes the final `(x, y, dx[])` that matches the screen.
- The two streams are paired 1:1 in this pass, but their text/counts differ.
  Do not compare rhwp against raw string length or the `DrawContext` text.
  Compare against `DuoDC` line-runs for visible canvas geometry.

Representative edited pairs:

```text
DrawContext x=-4093 y=-1265 count=38 dxSum=32124
  text="지급방법, 납기일에 대해서는 개별계약을 통해 정할ㅁ으ㅏᅟᅵᆫ 수 있음"
DuoDC       x=-68   y=-21   count=32 dxSum=535
  text="지급방법납기일에 대해서는 개별계약을 통해 정할ㅁ으ㅏ수 있음"

DrawContext x=-5611 y=3924 count=58 dxSum=48188
  text="---------------(이하 ‘원사업자’)와 –마이ᅟᅳᆫㅍㅍ으나미 따라 성실히 계약상의 권리를 행사"
DuoDC       x=50    y=65   count=35 dxSum=660
  text="이하 원사업자와 마이ㅍㅍ으나미 따라 성실히 계약상의 권리를 행사"

DrawContext x=-5611 y=7228 count=31 dxSum=26076
  text="한 후 각각 1부씩 보관한ㅁㅇㅍ나ㅣᅟᅳᆼ미프ㅏᅟᅳᆼㅁ다."
DuoDC       x=-94   y=120  count=23 dxSum=430
  text="한 후 각각 부씩 보관한ㅁㅇㅍ나ㅣ미프ㅏㅁ다"
```

Current inference:

- Hancom's edit-time line geometry is not paragraph reflow in browser terms.
  It is a sequence of visible `DuoDC` line-run fragments emitted after internal
  HwpApp layout and Hancom's text-stream normalization.
- The first implementation target in rhwp_core should be to preserve/derive
  final visible line-run fragments in the same semantic layer as `DuoDC`.
  Anything that uses raw paragraph text length, simple CSS/browser text
  wrapping, or a saved-vs-recomputed branch will continue to diverge.
