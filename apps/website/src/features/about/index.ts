/**
 * The public surface of the About-pages overlay.
 *
 * `admin.ts` and `uploads.ts` are deliberately absent — the same discipline as
 * `features/events`: a write helper should never be one careless import away
 * from a page the parish reads. The five routes need exactly what is here.
 */
export { AboutOverlay } from './AboutOverlay';
export { AboutSections } from './AboutSections';
export { Editable } from './Editable';
export { EditableHeading } from './EditableHeading';
export { EditablePicture } from './EditablePicture';
export { getAboutOverride, type BakedAbout } from './data';
export { ABOUT_BANDS, type AboutBand, type AboutSlotSpec } from './slots';
