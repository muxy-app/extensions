import { PopoverShell, mount_popover } from "@/popovers/popover-shell";
import { PrInfoPanel } from "./pr-info-panel";

mount_popover(
  <PopoverShell>
    <PrInfoPanel />
  </PopoverShell>,
);
