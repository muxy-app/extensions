import "@/shared/base.css";
import "@/shared/controls.css";
import "@/create-pr/create-pr.css";
import { CreatePrForm } from "@/create-pr/form";

function close() {
  Promise.resolve(muxy.modal.closeWebview?.()).catch(() => muxy.lifecycle?.close?.());
}

const root = document.getElementById("root");
if (root) {
  const form = new CreatePrForm(root, {
    onCancel: close,
    onDone: async (result) => {
      await muxy.modal.submitWebview?.(result)?.catch?.(() => undefined);
      close();
    },
  });
  muxy.lifecycle?.onBeforeClose?.(() => form.busy);
  void form.start();
}
