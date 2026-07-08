import { jsonLd } from "@/lib/seo";

/**
 * Emits a JSON-LD structured-data block. Search crawlers read this to build
 * rich results; it renders nothing visible. We stringify ourselves rather than
 * pass the object so the payload is compact and stable across renders.
 */
export function JsonLd({ schema }: { schema: object }) {
  return (
    <script
      type="application/ld+json"
      // eslint-disable-next-line react/no-danger -- JSON.stringify output, no user HTML
      dangerouslySetInnerHTML={{ __html: jsonLd(schema) }}
    />
  );
}
