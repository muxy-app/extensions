import { read_binary_base64 } from "./binary-data";
import { image_mime } from "../kinds";

export async function read_image_data_url(filePath) {
  const base64 = await read_binary_base64(filePath, "image");
  return `data:${image_mime(filePath)};base64,${base64}`;
}
