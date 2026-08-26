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
 * ## This notice has now been wrong about the audience twice
 *
 * Worth recording, because it is the same mistake in two forms and the next
 * person should expect to make it a third time.
 *
 * First it said public requests were readable by "any signed-in member of the
 * parish, so the community can pray with you". That stopped being true when
 * sign-in became Microsoft-only against the parish directory — clergy, staff and
 * servants have accounts, a parishioner does not.
 *
 * Then it described two audiences, "the fathers only" and "the fathers and the
 * prayer team", offered as a choice on the form. **The parish has no prayer
 * team.** The priests read these and nobody else does, so the choice was between
 * one real audience and one that does not exist — and picking the wrong one
 * implied to a parishioner that a congregation would read what they wrote. The
 * question is gone and `visibility` is gone from the schema with it.
 *
 * A privacy notice that overstates the audience is the one kind of inaccuracy
 * that is worse than saying nothing. Do not describe a reader of these requests
 * without checking that the reader exists.
 */
export function PrivacyDisclosure() {
  return (
    <div className="notice">
      <h2>Who can read your request</h2>
      <ul>
        <li>
          <strong>The fathers of this parish read these, and site administrators can.</strong>{' '}
          Being parish staff is not enough on its own, and nothing you write is shown
          anywhere on this website.
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
