import Link from "next/link";
import { GUIDE_ANCHORS, guideHref } from "@/lib/guide";

/** The « ? » next to a page title, opening that page's section of the guide. */
export default function HelpLink({ page }: { page: keyof typeof GUIDE_ANCHORS }) {
  return (
    <Link
      href={guideHref(page)}
      title="Aide de cette page"
      aria-label="Aide de cette page"
      className="ml-2 inline-block rounded-full border border-zinc-300 px-1.5 align-middle text-xs font-normal text-zinc-600 hover:text-zinc-900"
    >
      ?
    </Link>
  );
}
