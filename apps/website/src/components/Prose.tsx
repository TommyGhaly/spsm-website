import Markdown from 'react-markdown';

/**
 * Renders a `body` field.
 *
 * react-markdown rather than a markdown-to-HTML library plus
 * `dangerouslySetInnerHTML`: it produces React elements, so raw HTML in the
 * source is inert by default. Content is staff-authored, which lowers the risk
 * but does not remove it — a compromised staff account should not be able to
 * inject script into a page that every parishioner loads.
 */
export function Prose({ children }: { children: string }) {
  return (
    <div className="prose">
      <Markdown>{children}</Markdown>
    </div>
  );
}
