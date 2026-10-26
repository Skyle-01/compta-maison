import { readFile } from "node:fs/promises";
import { join } from "node:path";

// Screenshots of the guide live in docs/img (shown on GitHub too); only plain png names are served.
const IMG_DIR = join(process.cwd(), "..", "docs", "img");

export async function GET(_req: Request, { params }: { params: Promise<{ name: string }> }) {
  const { name } = await params;
  if (!/^[a-z0-9-]+\.png$/.test(name)) return new Response("Introuvable", { status: 404 });
  try {
    const png = await readFile(join(IMG_DIR, name));
    return new Response(png, { headers: { "Content-Type": "image/png" } });
  } catch {
    return new Response("Introuvable", { status: 404 });
  }
}
