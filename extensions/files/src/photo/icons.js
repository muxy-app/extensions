import { icon_svg } from "@/lib/dom";

export function EditImageIcon() {
  return icon_svg([
    { d: "M3 5.5A1.5 1.5 0 0 1 4.5 4h15A1.5 1.5 0 0 1 21 5.5v8" },
    { d: "M3 13.5V18.5A1.5 1.5 0 0 0 4.5 20H12" },
    { d: "M3 16l4.5-4.5a2 2 0 0 1 2.8 0L14 15" },
    { kind: "circle", attrs: { cx: "15.5", cy: "8.5", r: "1.5" } },
    { d: "M20.5 15.5 16 20l-2.5.5.5-2.5 4.5-4.5a1.4 1.4 0 0 1 2 2z" },
  ]);
}

export function RotateLeftIcon() {
  return icon_svg([
    { d: "M3 5v5h5" },
    { d: "M3.5 10a8.5 8.5 0 1 1 1.6 6.5" },
  ]);
}

export function RotateRightIcon() {
  return icon_svg([
    { d: "M21 5v5h-5" },
    { d: "M20.5 10a8.5 8.5 0 1 0-1.6 6.5" },
  ]);
}

export function FlipHorizontalIcon() {
  return icon_svg([
    { d: "M12 3v18" },
    { d: "M9 7 4 12l5 5z" },
    { d: "M15 7l5 5-5 5z" },
  ]);
}

export function FlipVerticalIcon() {
  return icon_svg([
    { d: "M3 12h18" },
    { d: "M7 9 12 4l5 5z" },
    { d: "M7 15l5 5 5-5z" },
  ]);
}

export function CropIcon() {
  return icon_svg([
    { d: "M6 2v14a2 2 0 0 0 2 2h14" },
    { d: "M2 6h14a2 2 0 0 1 2 2v14" },
  ]);
}

export function ResizeIcon() {
  return icon_svg([
    { d: "M4 4h9v9H4z" },
    { d: "M11 11h9v9h-9z" },
  ]);
}

export function ColorIcon() {
  return icon_svg([
    { d: "M4 7h9M17 7h3" },
    { d: "M4 12h3M11 12h9" },
    { d: "M4 17h13M21 17h-1" },
    { kind: "circle", attrs: { cx: "15", cy: "7", r: "2" } },
    { kind: "circle", attrs: { cx: "9", cy: "12", r: "2" } },
    { kind: "circle", attrs: { cx: "19", cy: "17", r: "2" } },
  ]);
}

export function ResetIcon() {
  return icon_svg([
    { d: "M3 5v5h5" },
    { d: "M3.5 10a8.5 8.5 0 1 1 1.6 6.5" },
  ]);
}

export function TrimIcon() {
  return icon_svg([
    { d: "M4 9V5a1 1 0 0 1 1-1h4" },
    { d: "M20 9V5a1 1 0 0 0-1-1h-4" },
    { d: "M4 15v4a1 1 0 0 0 1 1h4" },
    { d: "M20 15v4a1 1 0 0 1-1 1h-4" },
  ]);
}

export function CopyFileIcon() {
  return icon_svg([
    { d: "M9 9h10a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1V10a1 1 0 0 1 1-1z" },
    { d: "M5 15H4a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v1" },
  ]);
}

export function CheckIcon() {
  return icon_svg([{ d: "M20 6 9 17l-5-5" }]);
}

export function UndoIcon() {
  return icon_svg([
    { d: "M3 7v6h6" },
    { d: "M3.5 13a8 8 0 1 1 2 6" },
  ]);
}

export function RedoIcon() {
  return icon_svg([
    { d: "M21 7v6h-6" },
    { d: "M20.5 13a8 8 0 1 0-2 6" },
  ]);
}
