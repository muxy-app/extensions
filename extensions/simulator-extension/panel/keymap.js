// KeyboardEvent.code -> USB HID keyboard usage, which is what the simulator's
// hardware keyboard takes. Codes are physical keys, so iOS applies its own
// keyboard layout, as with a real keyboard.
"use strict";

const HID_USAGE = (() => {
  const map = {};
  "ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").forEach((letter, i) => { map[`Key${letter}`] = 4 + i; });
  "123456789".split("").forEach((digit, i) => { map[`Digit${digit}`] = 30 + i; });
  map.Digit0 = 39;
  for (let i = 1; i <= 12; i++) map[`F${i}`] = 57 + i;
  Object.assign(map, {
    Enter: 40, NumpadEnter: 40, Escape: 41, Backspace: 42, Tab: 43, Space: 44,
    Minus: 45, Equal: 46, BracketLeft: 47, BracketRight: 48, Backslash: 49,
    Semicolon: 51, Quote: 52, Backquote: 53, Comma: 54, Period: 55, Slash: 56,
    CapsLock: 57, Insert: 73, Home: 74, PageUp: 75, Delete: 76, End: 77, PageDown: 78,
    ArrowRight: 79, ArrowLeft: 80, ArrowDown: 81, ArrowUp: 82,
    IntlBackslash: 100,
    ControlLeft: 224, ShiftLeft: 225, AltLeft: 226, MetaLeft: 227,
    ControlRight: 228, ShiftRight: 229, AltRight: 230, MetaRight: 231,
  });
  return Object.freeze(map);
})();
