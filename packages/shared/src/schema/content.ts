import type { AuditFields, Publishable } from './common.js';

/**
 * Everything that was a hand-built Wix page and is really just prose:
 * Who We Are, Our Beliefs, clergy bios, Contact Us copy.
 *
 * These are read at build time by the static export, so editing one means a
 * redeploy. That's the correct trade for content that changes twice a year —
 * it also means these pages work offline for free (PWA requirement §3.6).
 */
export interface ContentPage extends AuditFields, Publishable {
  slug: string;
  title: string;
  /** Markdown. */
  body: string;
  /** Ordering within `section` for nav generation. */
  order: number;
  section: ContentSection;

  /** Populated only for `section: 'clergy'`. */
  person: ClergyBio | null;

  seo: {
    description: string | null;
    ogImagePath: string | null;
  };
}

/**
 * `welcome` is the onboarding section — what a newcomer or an enquirer reads
 * first. It is deliberately separate from `about`: "who this parish is" and
 * "what to expect if you have never been to a Coptic liturgy" are different
 * questions, and answering the second inside the first buries it.
 *
 * The old Wix catechism pages (`/lesson-1`, `/lesson-2`, `/lesson-3-saint-mina`)
 * redirect here.
 *
 * `ministries` is the standing work of the parish — the groups that meet and
 * serve, as distinct from `events`, which is things that happen on a date. Wix
 * filed both under `projects` with names like `/projects-7-2`, which is how the
 * homeless-feeding ministry ended up with a URL nobody could read, guess, or
 * say out loud. Each ministry is a page in this section, anchored by its slug.
 */
export const CONTENT_SECTIONS = [
  'welcome',
  'about',
  'beliefs',
  'clergy',
  'ministries',
  'contact',
  'misc',
] as const;
export type ContentSection = (typeof CONTENT_SECTIONS)[number];

/** Bishop David, Fr. Youhanna, Fr. Armia. */
export interface ClergyBio {
  /** Full display name including title, exactly as the parish writes it. */
  name: string;
  /** "Bishop", "Priest", "Deacon". */
  rank: string;
  portraitPath: string | null;
  email: string | null;
}

/**
 * Member profile. Doc id is the Firebase Auth uid.
 *
 * `role`/`groups` are mirrored here from custom claims for display and staff
 * directory listing only. Claims remain authoritative — rules must read the
 * token, never this document, or a member could grant themselves staff by
 * editing their own profile.
 */
export interface Member extends AuditFields {
  displayName: string;
  email: string;
  phone: string | null;
  photoPath: string | null;

  /** Display mirror of custom claims. NOT authoritative. */
  roleMirror: string;
  groupsMirror: string[];

  /** Which auth provider they came in through — Firebase or Entra ID. */
  authProvider: AuthProvider;

  notificationPrefs: {
    announcements: boolean;
    prayerTeam: boolean;
    orderUpdates: boolean;
  };
}

export const AUTH_PROVIDERS = ['password', 'google', 'microsoft'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];
