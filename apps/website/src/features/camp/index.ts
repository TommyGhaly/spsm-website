/**
 * Public surface of the camp feature.
 *
 * The screens are deliberately absent. Each is the whole of one route —
 * /admin/camp and its three tabs, and the public sign-up on /forms/summer-camp
 * — and the routes import them directly. Re-exporting them here would drag the
 * registration editor, the groups board and the register into `FormsHub` and
 * `sections.ts`, which import this file only to ask a yes/no question.
 *
 * The hook is here because that question is what it answers: whether to show
 * the camp at all, and to whom.
 */
export { useCampAdmin, type CampAdminSession } from './useCampAdmin';
