/**
 * What we promise about prayer request confidentiality, and what we don't.
 *
 * This component exists because docs/decisions.md #1 says the trade-off must be
 * stated plainly in the submission UI rather than papered over. Bodies are
 * stored as plaintext in Firestore; confidentiality comes from security rules,
 * not cryptography. Anyone with the Firebase service account or console access
 * can read every request.
 *
 * That was the right call — clergy have to actually read and follow up on these,
 * and true end-to-end encryption would have meant distributing keys to clergy
 * anyway, reintroducing the same trust boundary while giving up search,
 * notifications, and any hope of recovery. But someone writing about a private
 * matter deserves to know it before they type, not after.
 *
 * Do not soften this copy without revisiting that decision.
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
          <strong>Public requests</strong> are readable by any signed-in member of the
          parish, so the community can pray with you.
        </li>
        <li>
          Requests are stored as ordinary text. They are protected by access rules, not
          by encryption — so the people who administer the parish&apos;s systems are
          technically able to read them.
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
