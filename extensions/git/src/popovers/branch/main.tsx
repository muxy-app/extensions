import { PopoverShell, mount_popover } from "@/popovers/popover-shell";
import { BranchPanel } from "./branch-panel";

mount_popover(
  <PopoverShell>
    <BranchPanel />
  </PopoverShell>,
);
