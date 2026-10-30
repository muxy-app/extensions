import { copyFile } from 'node:fs/promises';
for (const file of ['package.json', 'LICENSE']) {
  await copyFile(new URL(`../${file}`, import.meta.url), new URL(`../dist/${file}`, import.meta.url));
}
