'use strict';

// Drive one reversible edit slowly enough for Hancom's deferred formatter to
// emit descriptors for both the inserted and restored document states.

function api(moduleName, name, result, args) {
  return new NativeFunction(Process.getModuleByName(moduleName).getExportByName(name), result, args);
}

const EnumWindows = api('user32.dll', 'EnumWindows', 'int', ['pointer', 'pointer']);
const EnumChildWindows = api('user32.dll', 'EnumChildWindows', 'int', ['pointer', 'pointer', 'pointer']);
const GetWindowThreadProcessId = api('user32.dll', 'GetWindowThreadProcessId', 'uint', ['pointer', 'pointer']);
const GetClassNameW = api('user32.dll', 'GetClassNameW', 'int', ['pointer', 'pointer', 'int']);
const IsWindowVisible = api('user32.dll', 'IsWindowVisible', 'int', ['pointer']);
const SetForegroundWindow = api('user32.dll', 'SetForegroundWindow', 'int', ['pointer']);
const SetFocus = api('user32.dll', 'SetFocus', 'pointer', ['pointer']);
const AttachThreadInput = api('user32.dll', 'AttachThreadInput', 'int', ['uint', 'uint', 'int']);
const SendInput = api('user32.dll', 'SendInput', 'uint', ['uint', 'pointer', 'int']);
const GetCurrentThreadId = api('kernel32.dll', 'GetCurrentThreadId', 'uint', []);
const Sleep = api('kernel32.dll', 'Sleep', 'void', ['uint']);

function className(hwnd) {
  const buffer = Memory.alloc(512);
  const length = GetClassNameW(hwnd, buffer, 256);
  return length > 0 ? buffer.readUtf16String(length) : '';
}

function owner(hwnd) {
  const pid = Memory.alloc(4);
  const tid = GetWindowThreadProcessId(hwnd, pid);
  return { tid, pid: pid.readU32() };
}

function findEditor() {
  const result = { main: ptr(0), edit: ptr(0), tid: 0 };
  const top = new NativeCallback((hwnd) => {
    const own = owner(hwnd);
    if (own.pid !== Process.id || IsWindowVisible(hwnd) === 0) return 1;
    const child = new NativeCallback((candidate) => {
      if (owner(candidate).pid === Process.id && className(candidate) === 'HwpMainEditWnd') {
        result.main = hwnd;
        result.edit = candidate;
        result.tid = own.tid;
        return 0;
      }
      return 1;
    }, 'int', ['pointer', 'pointer']);
    EnumChildWindows(hwnd, child, ptr(0));
    return result.edit.isNull() ? 1 : 0;
  }, 'int', ['pointer', 'pointer']);
  EnumWindows(top, ptr(0));
  return result;
}

function sendKeyboard(vk, scan, flags) {
  const input = Memory.alloc(28);
  input.writeU32(1);
  input.add(4).writeU16(vk);
  input.add(6).writeU16(scan);
  input.add(8).writeU32(flags);
  input.add(12).writeU32(0);
  input.add(16).writePointer(ptr(0));
  return SendInput(1, input, 28);
}

function key(vk) {
  return [sendKeyboard(vk, 0, 0), sendKeyboard(vk, 0, 2)];
}

function unicode(codeUnit) {
  return [sendKeyboard(0, codeUnit, 4), sendKeyboard(0, codeUnit, 6)];
}

const windows = findEditor();
if (windows.edit.isNull()) {
  send({ kind: 'failure', reason: 'HwpMainEditWnd not found' });
} else {
  const workerTid = GetCurrentThreadId();
  const attached = AttachThreadInput(workerTid, windows.tid, 1);
  SetForegroundWindow(windows.main);
  SetFocus(windows.edit);
  key(0x23); // End
  Sleep(500);

  const insertResult = unicode(0x78); // x
  send({ kind: 'edit_marker', state: 'inserted', atMs: Date.now(), insertResult });
  Sleep(10000);

  const deleteResult = key(0x08); // Backspace
  send({ kind: 'edit_marker', state: 'restored', atMs: Date.now(), deleteResult });
  Sleep(10000);

  AttachThreadInput(workerTid, windows.tid, 0);
  send({ kind: 'drive_complete', atMs: Date.now(), attached, uiTid: windows.tid });
}
