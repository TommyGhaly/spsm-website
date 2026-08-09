/**
 * Giving.
 *
 * Deliberately a link, not an integration. Tithe.ly API access is still pending
 * a request to support@tithe.ly, and even once granted it only buys us *reading
 * schedules back* — the giving flow itself is a Tithe.ly-hosted page either way.
 * So this stays useful with no API access at all, which is also the fallback if
 * the request is declined. See docs/decisions.md #2.
 *
 * The URL is public config and needs no credentials. It is read from the
 * environment rather than Firestore because it is inlined at build time
 * alongside the other NEXT_PUBLIC_ values.
 */
export function GivingPanel({ givingUrl }: { givingUrl: string | null }) {
  if (!givingUrl) {
    return (
      <div className="notice">
        <h2>Online giving is being set up</h2>
        <p>
          The parish&apos;s online giving page isn&apos;t linked here yet. In the meantime,
          offerings can be given in person, or the parish office can point you to the
          current link.
        </p>
      </div>
    );
  }

  return (
    <div className="prose">
      <p>
        Offerings and donations are handled through the parish&apos;s secure giving page.
        You can give once or set up recurring giving there.
      </p>
      <p>
        <a className="button" href={givingUrl} rel="noopener noreferrer" target="_blank">
          Give online →
        </a>
      </p>
      <p className="meta">
        This link opens Tithe.ly, which processes the payment. The parish website never
        sees your card details.
      </p>
    </div>
  );
}
