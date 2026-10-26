import { readFile } from "node:fs/promises";
import { join } from "node:path";
import ReactMarkdown, { type Components } from "react-markdown";
import rehypeSlug from "rehype-slug";

// docs/guide.md is the single source: readable on GitHub, rendered here. next runs from frontend/.
const GUIDE_PATH = join(process.cwd(), "..", "docs", "guide.md");

// scroll-mt keeps a heading clear of the top when an anchor jumps to it.
const components: Components = {
  h1: (p) => <h1 className="text-xl font-semibold" {...p} />,
  h2: (p) => <h2 className="mt-10 scroll-mt-4 border-b border-zinc-200 pb-1 text-lg font-semibold" {...p} />,
  h3: (p) => <h3 className="mt-6 scroll-mt-4 font-semibold" {...p} />,
  p: (p) => <p className="mt-3 text-sm leading-relaxed text-zinc-800" {...p} />,
  ul: (p) => <ul className="mt-3 list-disc space-y-1 pl-6 text-sm text-zinc-800" {...p} />,
  ol: (p) => <ol className="mt-3 list-decimal space-y-1 pl-6 text-sm text-zinc-800" {...p} />,
  a: (p) => <a className="text-blue-700 underline" {...p} />,
  // The guide writes img/x.png (valid on GitHub); the app serves them from /aide/img/.
  // eslint-disable-next-line @next/next/no-img-element
  img: ({ src, alt }) => <img src={`/aide/${src}`} alt={alt} className="mt-3 rounded border border-zinc-200" />,
  code: (p) => <code className="rounded bg-zinc-100 px-1 text-xs" {...p} />,
  table: (p) => <table className="mt-3 w-full border-collapse text-sm" {...p} />,
  th: (p) => <th className="border border-zinc-200 bg-zinc-50 px-2 py-1 text-left" {...p} />,
  td: (p) => <td className="border border-zinc-200 px-2 py-1" {...p} />,
};

/** The user guide (docs/guide.md); every page's « ? » link points at one of its headings. */
export default async function AidePage() {
  const markdown = await readFile(GUIDE_PATH, "utf8");
  return (
    <article className="max-w-3xl">
      <ReactMarkdown rehypePlugins={[rehypeSlug]} components={components}>
        {markdown}
      </ReactMarkdown>
    </article>
  );
}
