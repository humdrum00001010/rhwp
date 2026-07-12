# Hancom Line Layout Capture Method

This method records one edit at a time and waits for Hancom to emit the
corresponding line descriptors before applying the next edit. It is intended
for recovering layout semantics, not for treating paint output as the layout
algorithm.

## Environment

- Windows VM: `ssh wqemu`
- Frida endpoint: `127.0.0.1:27042`
- Hancom executable:
  `C:\Program Files (x86)\HNC\Office 2022\HOffice120\Bin\Hwp.exe`
- Preserved evidence root: `~/Documents/hancom/captures/`

Verify the remote server before starting:

```sh
frida-ps -H 127.0.0.1:27042
```

Use one `Hwp.exe` process and one local capture harness. Before attaching,
check for stale harnesses:

```sh
ps -axo pid,ppid,state,command |
  rg 'run_frida_(closed_loop|jsonl)_capture|frida -H'
```

Resolve recovery and Find dialogs, then confirm that the visible window title
belongs to the intended document. Verify `GetGUIThreadInfo(...).hwndFocus`
equals the visible `HwpMainEditWnd`. A successful input API return does not
prove a document edit; the expected descriptor is the acknowledgement.

For an automation-created document, keep the owning PowerShell COM object
alive for the duration of the capture. Releasing the owner can leave a
headless `Hwp.exe` broker with no document window. Resolve Hancom's recovery
dialog before checking window visibility, then foreground the process-owned
top-level window from an interactive-session task.

## Transport

The probe sends structured messages with Frida `send(...)`. A Python message
handler writes each event directly to JSONL. Do not use `console.log(...)`
through the Frida CLI PTY for a timing capture; backpressure can delay Hancom
and invalidate edit timing.

The capture process exits without explicitly calling `script.unload()` or
`session.detach()`. Previous explicit teardown attempts blocked and left
duplicate hooks attached. After every failed attempt, repeat the local harness
check before collecting evidence.

## Closed Loop

Use external interactive-session `SendInput`; in-process `WM_CHAR` did not
reliably exercise the visible edit path.

For 32-bit `Hwp.exe`, pass `28` as `cbSize`. `KEYBDINPUT` itself is smaller,
but the `INPUT` union is sized by `MOUSEINPUT`. A 20-byte value returns zero
and must be treated as rejected input.

For edit commands `u_0, u_1, ...`, the driver is:

```text
send u_k
wait for descriptor(paragraph_identity, expected_source_length_k)
record all line descriptors for that state
send u_(k+1)
```

Do not infer an intermediate state from elapsed time. An edit is acknowledged
only after the expected paragraph identity and source length appear in the
descriptor stream.

Some large converted documents defer the visible formatter pass for several
seconds after `SendInput` succeeds. A fixed short sleep can therefore collapse
an insert/delete pair into one final reflow and hide the intermediate state.
When a message-driven closed loop is not available, hold each state long
enough to observe a descriptor containing the inserted marker before sending
the inverse edit. The accepted HWP3-converted mixed-script capture used 10
seconds per state; its earlier 1.5-second attempt was rejected because only the
restored paragraph was emitted.

## Current Descriptor Probe

The verified table-cell probe is at `HwpApp.dll+0x189ab5`.

| Field | Observed meaning |
| --- | --- |
| `ebx+0x00` | source interval start |
| `ebx+0x2c` | source interval end |
| `ebx+0x1c` | available line width |
| `ebx+0x04` | line vertical position |
| `ebx+0x34` | `(end << 8) | start` in the verified fixture |
| `esi+0x1c` | stable paragraph identity in the verified fixture |

These offsets describe emitted line state. They do not identify the internal
advance calculation or break-selection algorithm.

## Verification

A valid reversible run must satisfy all of the following:

1. Every insertion and deletion is acknowledged individually.
2. Source intervals are contiguous and include the terminal U+000D.
3. Reversing an edit restores the exact prior interval sequence.
4. The packed interval invariant is checked for every descriptor.
5. The raw JSONL, probe, driver, and document screenshot remain together in a
   timestamped capture directory.

The verified reference run is:

```text
~/Documents/hancom/captures/
  20260710-201357-break-allowed-cases-live/
```

## Code-Level Capture Requirement

Descriptor emission is an output oracle. A code-level semantics capture must
trace backward from `HwpApp.dll+0x189ab5` and record, for each candidate source
position:

```text
paragraph identity
source start and candidate end
style/font/matrix identity
computed horizontal advance
available width
break class or priority
accepted/rejected branch
selected endpoint
```

Advance and break selection are separate experiments. Keep the descriptor hook
as an acknowledgement oracle, but add only one candidate hook at a time.

An interior or candidate hook that terminates `Hwp.exe` is rejected. Reopen the
original native fixture, verify one visible process, and return to the last
confirmed function-entry probes. A document that renders briefly and then
terminates is not a valid semantic fixture.

## Current Code-Level Probe

The current target document is
`hancom-line-break-boundary-tj5.hwpx`. Candidate probes exist at:

| RVA | Role | Recorded values |
| --- | --- | --- |
| `0x1cfe90` | shaped run advance core | UTF-16 run, count, output advance array, drawing-backend vtable target `+0x150` |
| `0x1dd070` | overflow break selection | cumulative advance array, available width, overflow position, selected position/state, run vtable target `+0x24` |

Font/style shaping splits a paragraph into runs. An individual run passed to
`0x1cfe90` need not contain the paragraph's textual prefix, so filtering the
run text itself loses valid calls. The attempted thread bracket at `0x1dde10`
is not yet valid: `formatter+0xa0` was not proven to reference the target
paragraph. Keep `0x189ab5` as the paragraph oracle while resolving that
relationship; do not publish advance or break events from an unproven bracket.

The probe and raw output are:

```text
~/Documents/hancom/captures/
  20260711-000652-hwpapp-code-level-line-layout/
    tools/trace_tj5_advance_break.js
    raw/trace_tj5_advance_break-pid4312-r4.jsonl
    raw/trace_tj5_formatter_relation-pid4312.jsonl
```

Only confirmed function entries are intercepted. Hooks at interior
instructions previously destabilized `Hwp.exe` and are not valid evidence.

The confirmed direct measurement record is preserved in:

```text
raw/trace_line_primitives_thread-pid10980-live.jsonl
raw/trace_break_candidates_all_threads-pid10980-r2-live.jsonl
```

For the target edit, pair events by the descriptor timestamp and GUI thread
`9388`. Do not treat unrelated measurement calls on that thread as target
evidence; require target text or the target paragraph pointer
`0x1e8bbd88` in the same edit window.

For `FUN_101dd900`, the hidden return pointer is the first stack argument. Read
its output as a 32-bit source position at offset 0 and a one-byte state at
offset 4. Record the caller module/RVA and the input overflow position. Do not
infer the selected endpoint from the painted line when this output record is
available.

Record `FUN_101dd070` and `FUN_101dd900` outputs independently. The native
Latin run proves that the selector can return 211 while the wrapper finalizes
302 and the emitted descriptor starts at 302. Treating the selector return as
the final boundary loses wrapper semantics.

To exercise the hyphenation branch, change the paragraph through Hancom's own
paragraph dialog and require the classifier to report `run_flags = 0x1a0` and
`run_class = 0x20`. A raw-file rewrite that terminates Hancom is rejected.
Record the full `FUN_10657c80` input segment, return value, helper return value,
selector output, wrapper output, and emitted descriptors. A return of
`0xffffffff` is a valid no-candidate result, not an accepted break point.

For an accepted-candidate fixture, use a table cell whose available width is
smaller than a known hyphenatable word. Resize the selected one-column table
with Hancom's native `Ctrl+Left` command and record every intermediate width.
For `internationalization`, the reference accepted transition is:

```text
width=9236 overflow=19 helper=7 candidate=15 selector=16 wrapper=16
width=8104 overflow=17 candidates=15,13 selector=14 wrapper=14
```

Do not infer the source endpoint directly from the candidate offset. The
captured conversion for segment origin `s` is `s + offset + 1`. Keep the
descriptor oracle attached after resizing settles, then force one reversible
text edit so final intervals are emitted outside the live resize loop.

For every wrapper event, also read the paragraph pointer at `formatter+0xa0`
and record its UTF-16 text. A selector call without that ownership field proves
the code path but cannot be assigned to a named fixture paragraph. Target input
is valid only when the paragraph-specific descriptor oracle records the changed
text and intervals.
