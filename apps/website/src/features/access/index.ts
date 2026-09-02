export { AccessScreen } from './AccessScreen';
/*
 * The rows the page draws, plus the two derived lists that keep it honest about
 * the flags it does not.
 *
 * `AREA_CONTENT` used to be re-exported here. It and the four other rows whose
 * editors do not exist are gone from `areas.ts` entirely — write the row with
 * the editor, and see the note at the top of that file for why the old copy was
 * not worth keeping.
 */
export {
  ACCESS_AREAS,
  SCREEN_AREAS,
  UNOFFERED_LABELS,
  UNOFFERED_SCREENS,
  AREA_BOOKSTORE,
  AREA_CAMP,
  AREA_EVENTS,
  AREA_FINANCE,
  AREA_FORMS,
  AREA_PROGRAMS,
  FINANCE_SOURCE_ROWS,
  type AccessArea,
  type FinanceSourceRow,
} from './areas';
