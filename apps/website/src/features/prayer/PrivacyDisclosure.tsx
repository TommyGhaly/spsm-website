/**
 * What we promise about prayer request confidentiality, and what we don't.
 *
 * This component exists because docs/decisions.md #1 says the trade-off must be
 * stated plainly in the submission UI rather than papered over. That obligation
 * did not go away when the storage changed — it just changed what has to be
 * said.
 *
 * ---------------------------------------------------------------------------
 * Rewritten 2026-08-26, when the requests were sealed.
 *
 * The third bullet used to read: "Requests are stored as ordinary text. They
 * are protected by access rules, not by encryption — so the people who
 * administer the parish's systems are technically able to read them."
 *
 * That was accurate and is now false. Bodies, names and contact addresses are
 * AES-256-GCM envelopes; the database holds ciphertext. Leaving the old copy up
 * would have understated the protection, which is a gentler failure than
 * overstating it and is still a false statement on a privacy notice.
 *
 * **The new copy still does not claim more than is true**, and that is the part
 * to guard. This is not end-to-end encryption: clergy must be able to read
 * these, so a key exists on the parish's servers, and whoever administers those
 * servers can decrypt. Decision #1's central reasoning survives — only the
 * database changed. Somebody writing about a private matter deserves that
 * distinction before they type, not after.
 *
 * Do not soften this copy, and do not let it drift into promising secrecy from
 * the parish's own administrators. The last line — speak to a father directly —
 * is the honest answer for anything that needs more than this.
 *
 * One line was corrected when the form shipped. It said public requests were
 * readable by "any signed-in member of the parish, so the community can pray
 * with you", which stopped being true when sign-in became Microsoft-only
 * against the parish directory: clergy, staff and servants have accounts and a
 * parishioner does not. It now says who actually reads them. A privacy notice
 * that overstates the audience is the one kind of inaccuracy that is worse than
 * saying nothing.
 */
export function PrivacyDisclosure() {
  return (
    <div className="notice">
      <h2>Who can read your request</h2>
      <ul>
        <li>
          <strong>Clergy-only requests</strong> are readable by the fathers of this parish
          and by site administrators. Being parish staff is not enough on its own.
        </li>
        <li>
          <strong>Public requests</strong> are readable by the fathers and by the parish
          servants who pray for them. They are not shown anywhere on this website.
        </li>
        <li>
          <strong>Requests are encrypted before they are stored.</strong> What is kept
          in the parish database is unreadable on its own — a copy of the database,
          or of a backup, gives nothing away.
        </li>
        <li>
          This is not a promise of secrecy from the parish itself. The fathers have to
          be able to read what you write, so the key is held on the parish&apos;s
          systems, and whoever administers those systems can read a request. What the
          encryption prevents is anyone reading the database without that key.
        </li>
        <li>
          <strong>Submitting anonymously genuinely removes your name.</strong> We do not
          store a hidden link back to you. The trade-off is real: an anonymous request
          can&apos;t later be edited or withdrawn by you, because there is nothing tying
          it to you.
        </li>
      </ul>
      <p>
        If a matter is too sensitive for that, please speak to one of the fathers
        directly rather than using this form.
      </p>
    </div>
  );
}
