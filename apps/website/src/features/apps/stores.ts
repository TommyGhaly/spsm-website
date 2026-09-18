/**
 * The apps the parish asks anyone to install, and where each one lives.
 *
 * Literals, not Firestore. An app's store URL changes when the app is
 * re-published under a new identifier, which is roughly never, and a bad read
 * that emptied this page would leave a page whose entire purpose is two links.
 *
 * **Every URL here has been opened.** That is not a formality: `/giving` links
 * the *giving* app and there are two Tithe.ly apps — see the note on that
 * entry — and a store link that goes to the wrong product sends a parishioner
 * to something they cannot use and cannot tell is wrong.
 */
export type ParishApp = {
  /** The name as it appears on the store listing. */
  name: string;
  /** Who publishes it, when that is not the parish itself. */
  by?: string;
  /** What it is for, in one or two sentences. */
  what: string;
  /**
   * The app's own icon, as the stem of the files the pipeline writes — the card
   * appends `-128.webp` and `-192.webp`. See the app-icons block in
   * scripts/optimize-assets.mjs, and `assets/README.md` for where each one came
   * from and who owns it.
   *
   * Optional, and today all three have one. It stayed optional when SPSM
   * Connect got its icon because the rule behind the empty slot has not
   * changed: an app with no artwork renders no picture at all rather than a
   * placeholder, since an invented mark is the one thing on this page that
   * could mislead somebody. SPSM Connect's is not invented — it is the parish
   * seal the app itself ships, copied from the app repository.
   */
  icon?: string;
  /** App Store URL, absent when it is not on the App Store. */
  ios?: string;
  /** Google Play URL, absent when it is not on Play. */
  android?: string;
  /**
   * Set on an app that cannot be installed yet, and it is what the card says
   * instead of showing badges.
   *
   * It is a plain sentence rather than a date, and it must stay that way until
   * there is a date somebody is willing to be held to.
   */
  unreleased?: string;
  /** A page on this site that says more, when there is one. */
  more?: { href: string; label: string };
};

/**
 * Tithe.ly's giving app, hoisted out of the list below because `/giving` links
 * it too.
 *
 * One record, two pages: the band at the bottom of `/giving` and the card on
 * `/apps` are the same two links, and a second copy of these URLs is a second
 * chance to paste the wrong product id.
 */
export const TITHELY_APP: ParishApp = {
  name: 'Tithe.ly',
  by: 'Tithe.ly',
  icon: 'app-tithely',
  what:
    'Gives to the church from a phone, once or on a schedule — the same offering as the form on the Giving page.',
  /*
   * The *giving* app, and getting this right matters.
   *
   * Tithe.ly ships two products under similar names: `id694740700` /
   * `ly.tithe.tithely` is the giving app, which is what the parish's form
   * belongs to, and `id565301194` / `com.churchlinkapp` is "Church App —
   * Tithe.ly", a separate paid product with sermons and groups that this parish
   * does not have. Linking the second would send people to something they cannot
   * use.
   */
  ios: 'https://apps.apple.com/us/app/tithe-ly/id694740700',
  android: 'https://play.google.com/store/apps/details?id=ly.tithe.tithely',
  more: { href: '/giving', label: 'How the church receives an offering' },
};

export const PARISH_APPS: readonly ParishApp[] = [
  {
    name: 'Taksis',
    /*
     * The parish's own, and the App Store says so — the seller is
     * "ST. PHILOPATER MERCURIUS & ST. MINA COPTIC ORTHODOX CHURCH, INC."
     *
     * It is also the service the parish's forms write into: a vehicle
     * registration submitted on this site becomes a pending record in Taksis
     * and nowhere else. See docs/integrations.md.
     */
    what:
      'Our own app. Servants’ schedules and attendance are kept in it, and a parent manages their children’s accounts from it.',
    // The sixth-century icon of Christ and St. Menas, which is what the parish
    // chose for its own app. Nothing here picked it.
    icon: 'app-taksis',
    ios: 'https://apps.apple.com/us/app/taksis/id6743824691',
    android: 'https://play.google.com/store/apps/details?id=com.tghaly.taksis',
  },
  TITHELY_APP,
  {
    name: 'SPSM Connect',
    /*
     * The parish's second app, and the second part of the three-part program the
     * website is the first part of.
     *
     * It is listed with no links and no date on purpose. Tommy: *"eventually
     * spsm connect but its not a thing yet."* Naming an unbuilt app is worth it
     * — somebody will hear it mentioned and come looking — but the honest thing
     * for this card to say is that there is nothing to install, and it must not
     * grow a feature list, a screenshot, or a month.
     */
    what: 'Our next app, for everyone rather than for servants.',
    /*
     * The parish's own seal on the brand ground, which is the icon the app
     * ships and the one Apple has — not an invention for a card, which is what
     * the empty slot in `ParishAppCard` exists to prevent. Its source is a copy
     * of the app repository's generated `assets/icon.png`; the app-icons block
     * in scripts/optimize-assets.mjs says when to re-copy it.
     */
    icon: 'app-spsm-connect',
    unreleased: 'Being built. There is nothing to install yet.',
  },
];
