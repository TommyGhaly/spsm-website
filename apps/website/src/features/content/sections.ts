import type { ContentSection } from '@spsm/shared';

/**
 * Human-facing titles for the content sections.
 *
 * Kept beside the feature rather than in the route so the nav, the page, and
 * the sitemap all read the same list. `ContentSection` comes from the shared
 * schema, so a new section added there fails to typecheck here until it gets a
 * title — which is the point.
 */
export const SECTION_META: Record<ContentSection, { title: string; lede: string }> = {
  welcome: {
    title: 'Welcome',
    lede: 'New here, or curious? Start with this.',
  },
  about: {
    title: 'About the Parish',
    lede: 'Who we are, and how we came to be here.',
  },
  beliefs: {
    title: 'Our Faith',
    lede: 'What the Coptic Orthodox Church believes and confesses.',
  },
  clergy: {
    title: 'Our Clergy',
    lede: 'The fathers who serve this parish.',
  },
  ministries: {
    title: 'Ministries',
    lede: 'The groups that meet, serve, and welcome throughout the year.',
  },
  contact: {
    title: 'Contact Us',
    lede: 'How to reach the parish office.',
  },
  misc: {
    title: 'Parish Information',
    lede: '',
  },
};
