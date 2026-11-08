import {
  ORDINATION_RANKS,
  ORDINATION_RANK_INFO,
  ageOn,
  longDay,
  ordinationRankLabel,
  ordinationTitle,
  type Ordination,
  type OrdinationApplication,
} from '@spsm/shared';

/** Blank columns, one per person giving verbal approval; each writes their name at the top. */
const APPROVERS = 4;

const escape = (text: string) =>
  text.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);

/**
 * Requirements a nominee does not meet, as short notes for the sheet: under
 * the rank's minimum age on the ordination day, or no date of birth to tell.
 */
export function ordinationConcerns(ordination: Ordination, row: OrdinationApplication): string[] {
  const concerns: string[] = [];
  const minimum = ORDINATION_RANK_INFO[row.rank].minimumAge;
  const age = ageOn(row.nominee.dateOfBirth, ordination.date);
  if (age === null) concerns.push('No date of birth');
  else if (age < minimum) concerns.push(`Too young: ${age}, minimum is ${minimum}`);
  return concerns;
}

/**
 * A one-page-per-rank sheet listing every nominee still in the running
 * (waiting or approved, not rejected), with a blank column per approver to
 * tick yes / no and initial. It is printed from the browser, not the PDF
 * packet, because it is a working sheet for the parish and never goes to the
 * diocese.
 */
export function approvalListHtml(ordination: Ordination, applications: OrdinationApplication[]): string {
  const live = applications.filter((row) => row.status !== 'rejected');
  const approverHeads = Array.from(
    { length: APPROVERS },
    () => '<th class="who"><div class="line"></div><span>Yes / No · initials</span></th>',
  ).join('');

  const sections = ORDINATION_RANKS.map((rank) => {
    const rows = live
      .filter((row) => row.rank === rank)
      .sort((a, b) => a.nominee.name.localeCompare(b.nominee.name));
    if (rows.length === 0) return '';
    const body = rows
      .map((row, n) => {
        const age = ageOn(row.nominee.dateOfBirth, ordination.date);
        const concerns = ordinationConcerns(ordination, row);
        const detail = [row.nominee.schoolGrade, row.nominee.occupation].filter(Boolean).join(' · ');
        return `<tr>
  <td class="n">${n + 1}</td>
  <td><strong>${escape(row.nominee.name)}</strong>${detail ? `<div class="sub">${escape(detail)}</div>` : ''}</td>
  <td class="c">${age ?? ''}</td>
  <td class="flags">${concerns.length ? concerns.map((c) => `<div>⚠ ${escape(c)}</div>`).join('') : '<span class="ok">None</span>'}</td>
  <td>${escape(row.nominee.fatherOfConfession)}</td>
  <td class="c">${row.status === 'approved' ? 'Approved' : 'Waiting'}</td>
  ${'<td></td>'.repeat(APPROVERS)}
</tr>`;
      })
      .join('');
    return `<section>
<h2>${escape(ordinationRankLabel(rank))} <small>${rows.length}</small></h2>
<table>
  <thead><tr>
    <th class="n">#</th><th>Nominee</th><th class="c">Age</th><th>Age requirement</th><th>Father of confession</th><th class="c">Status</th>
    ${approverHeads}
  </tr></thead>
  <tbody>${body}</tbody>
</table>
</section>`;
  }).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Approval list · ${escape(ordinationTitle(ordination))}</title>
<style>
  @page { size: letter landscape; margin: 0.5in; }
  body { font: 11pt system-ui, -apple-system, sans-serif; color: #000; margin: 0; padding: 1rem; }
  h1 { font-size: 16pt; margin: 0 0 2pt; }
  .meta { margin: 0 0 12pt; color: #333; }
  section { break-after: page; }
  section:last-of-type { break-after: auto; }
  h2 { font-size: 13pt; margin: 14pt 0 6pt; }
  h2 small { font-weight: normal; color: #555; }
  table { width: 100%; border-collapse: collapse; }
  th, td { border: 1px solid #000; padding: 6pt 5pt; vertical-align: top; text-align: left; }
  th { font-size: 9pt; background: #eee; }
  td { height: 26pt; }
  .n { width: 18pt; text-align: center; }
  .c { text-align: center; }
  .sub { font-size: 9pt; color: #444; }
  .flags { font-size: 9pt; width: 1.8in; }
  .flags div { font-weight: 600; }
  .flags .ok { color: #555; }
  .who { width: 1.1in; }
  .who .line { border-bottom: 1px solid #000; height: 14pt; margin-bottom: 3pt; }
  .who span { font-weight: normal; font-size: 8pt; }
  thead { display: table-header-group; }
  tr { break-inside: avoid; }
  @media print { body { padding: 0; } th { -webkit-print-color-adjust: exact; print-color-adjust: exact; } }
</style></head>
<body>
<h1>Ordination nominees: approval list</h1>
<p class="meta">${escape(longDay(ordination.date))}${ordination.churchName ? ` · ${escape(ordination.churchName)}` : ''} · Printed ${escape(new Date().toLocaleDateString())}</p>
${sections || '<p>No nominees to list.</p>'}
<script>window.onload = () => window.print();</script>
</body></html>`;
}

/** Writes the sheet into a tab opened synchronously in the click, then prints it. */
export function openApprovalList(tab: Window | null, html: string) {
  if (!tab) throw new Error('The browser blocked the new tab. Allow pop-ups for this site and try again.');
  tab.document.open();
  tab.document.write(html);
  tab.document.close();
}
