import { promises as fs } from "node:fs";

export async function readContent(file?: string): Promise<string> {
  if (file && file !== "-") {
    return fs.readFile(file, "utf-8");
  }
  if (process.stdin.isTTY) {
    throw new Error("No content provided. Pass -f <file> or pipe content via stdin.");
  }
  return readStdin();
}

export async function readJsonContent<T>(file?: string): Promise<T> {
  const raw = await readContent(file);
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`Invalid JSON: ${(err as Error).message}`);
  }
}

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk);
  }
  return Buffer.concat(chunks).toString("utf-8");
}
