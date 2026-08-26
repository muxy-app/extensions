import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const FORBIDDEN = new Set(["tEXt", "zTXt", "iTXt", "eXIf"]);
const signature = Buffer.from("89504e470d0a1a0a", "hex");

for (const input of process.argv.slice(2)) {
  const path = resolve(input);
  const source = await readFile(path);
  if (!source.subarray(0, 8).equals(signature)) throw new Error(`${input}: not a PNG`);
  const chunks = [signature];
  let offset = 8;
  while (offset + 12 <= source.length) {
    const length = source.readUInt32BE(offset);
    const end = offset + 12 + length;
    if (end > source.length) throw new Error(`${input}: truncated PNG chunk`);
    const type = source.subarray(offset + 4, offset + 8).toString("ascii");
    if (!FORBIDDEN.has(type)) chunks.push(source.subarray(offset, end));
    offset = end;
    if (type === "IEND") break;
  }
  await writeFile(path, Buffer.concat(chunks));
  console.log(`stripped textual/EXIF PNG metadata: ${input}`);
}
