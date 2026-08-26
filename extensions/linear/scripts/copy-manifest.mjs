import { copyFile, mkdir, cp } from "node:fs/promises";
import { resolve } from "node:path";

// 배포/실행에는 dist/ 만 포함되므로, 매니페스트(package.json)와 리스팅 에셋(assets/)을
// dist 로 복사해 설치 가능한 자립형 확장을 만든다.
//
// assets/ 를 (public/ 이 아니라) 소스 루트에 두는 이유: Muxy 는 dist 가 없으면 소스
// 폴더를 그대로 읽는데(빌드 전 Load Unpacked, fresh clone 등), 그때도 매니페스트의
// `assets/icon.svg` 가 같은 상대경로에서 해석돼야 아이콘/스크린샷 경로 오류가 안 난다.
// 소스 루트와 dist 양쪽에서 동일한 `assets/...` 경로로 해석되도록 여기서 복사한다.
const root = resolve(import.meta.dirname, "..");
const dist = resolve(root, "dist");

await mkdir(dist, { recursive: true });
await copyFile(resolve(root, "package.json"), resolve(dist, "package.json"));
// vite 가 dist 를 비운 뒤(emptyOutDir) 실행되므로, 그 다음에 assets 를 넣는다.
// vite 번들이 dist/assets 에 이미 있으므로 병합되도록 recursive 로 복사한다.
await cp(resolve(root, "assets"), resolve(dist, "assets"), { recursive: true });
console.log("copied package.json + assets/ -> dist/");
