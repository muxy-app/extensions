// 모달/패널에서 발생한 오류를 화면에 드러내는 헬퍼.
// (오류가 조용히 삼켜지면 "불러오는 중…"에서 멈춰 원인을 알 수 없다.)

export function installFatalHandler(targetId = "app") {
  const show = (msg) => {
    const el = document.getElementById(targetId);
    if (el) {
      el.innerHTML = "";
      const box = document.createElement("div");
      box.style.cssText = "padding:12px;color:#e5534b;font-size:12px;white-space:pre-wrap;word-break:break-word";
      box.textContent = "Error: " + msg;
      el.append(box);
    }
  };
  window.addEventListener("error", (e) => show(e.message || String(e.error)));
  // 처리되지 않은 promise 거부(예: 권한 없는 토스트)는 화면을 덮지 않고 로그만 남긴다.
  // 실제 렌더 오류는 각 화면의 try/catch 가 직접 표시한다.
  window.addEventListener("unhandledrejection", (e) => {
    console.error("[linear] unhandled:", e.reason?.message || String(e.reason));
    e.preventDefault();
  });
  return show;
}

// main() 을 실행하되, 실패하면 화면에 오류를 표시한다.
export async function run(main, targetId = "app") {
  const show = installFatalHandler(targetId);
  // window.muxy 자체가 없으면 브리지 주입 실패다.
  if (!window.muxy) {
    show("window.muxy 브리지가 주입되지 않았습니다.");
    return;
  }
  try {
    await main();
  } catch (err) {
    show(err?.message || String(err));
  }
}
