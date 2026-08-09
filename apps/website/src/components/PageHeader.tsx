/**
 * The h1 + lede every top-level page opens with.
 *
 * Small, but it keeps heading structure consistent across features that
 * different people will write at different times — which is the thing that
 * quietly degrades into `h1` inside `h1` and unlabelled sections otherwise.
 */
export function PageHeader({ title, lede }: { title: string; lede?: string }) {
  return (
    <header className="prose">
      <h1>{title}</h1>
      {lede && <p className="lede">{lede}</p>}
    </header>
  );
}
