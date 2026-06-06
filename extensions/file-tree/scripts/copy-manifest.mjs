import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const dist = resolve(root, 'dist');
const packagePath = resolve(root, 'package.json');

await mkdir(dist, { recursive: true });
await copyFile(packagePath, resolve(dist, 'package.json'));

const packageManifest = JSON.parse(await readFile(packagePath, 'utf8'));
const legacyManifest = {
  name: packageManifest.name,
  version: packageManifest.version,
  ...packageManifest.muxy,
};

await writeFile(
  resolve(dist, 'manifest.json'),
  `${JSON.stringify(legacyManifest, null, 2)}\n`,
);
