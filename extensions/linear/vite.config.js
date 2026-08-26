import { resolve } from "node:path";
import { defineConfig } from "vite";

// 멀티 페이지 빌드: 패널 1개 + 모달들 + 탭(이슈 상세를 풀 탭 웹뷰로).
// 각 HTML은 dist 안에서 소스와 동일한 상대 경로로 출력된다.
export default defineConfig({
  // muxy-ext:// 스킴에서 상대 경로로 자산을 참조하도록 base 를 비운다.
  base: "",
  build: {
    outDir: "dist",
    emptyOutDir: true,
    rollupOptions: {
      input: {
        panel: resolve(__dirname, "panel/index.html"),
        issue: resolve(__dirname, "modals/issue.html"),
        create: resolve(__dirname, "modals/create.html"),
        settings: resolve(__dirname, "modals/settings.html"),
        link: resolve(__dirname, "modals/link.html"),
        apikeys: resolve(__dirname, "modals/apikeys.html"),
        tabIssue: resolve(__dirname, "tab/issue.html"),
        tabCreate: resolve(__dirname, "tab/create.html"),
      },
    },
  },
});
