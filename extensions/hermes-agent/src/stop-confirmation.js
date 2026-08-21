export async function requestConfirmedStop({ confirm, canStop, stop }) {
  if (typeof confirm !== "function") return "confirmation_unavailable";
  if (!canStop()) return "stale";

  let choice;
  try {
    choice = await confirm({
      title: "Stop this Hermes run?",
      message: "Hermes will cancel the active run. Completed output remains visible.",
      buttons: ["Keep running", "Stop run"],
    });
  } catch {
    return "confirmation_failed";
  }

  if (choice !== "Stop run") return "cancelled";
  if (!canStop()) return "stale";

  try {
    await stop();
    return "stopped";
  } catch {
    return "stop_failed";
  }
}
