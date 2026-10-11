'use client';

/**
 * A row of tabs over an editor's settings — the bookstore panel, the forms
 * builder, the event and About editors all use this one, so a tab and the dot
 * that says "unsaved changes here" look and behave the same everywhere.
 *
 * The caller renders the chosen tab's content; this only draws the row and
 * wires the ARIA, so the content can be any shape.
 */
export interface EditTab<T extends string> {
  id: T;
  label: string;
  /** Something on this tab is not saved yet. */
  dirty?: boolean;
}

export function EditTabs<T extends string>({
  tabs,
  value,
  onChange,
  label,
  idPrefix,
}: {
  tabs: readonly EditTab<T>[];
  value: T;
  onChange: (next: T) => void;
  /** What the tabs are settings for, for a screen reader. */
  label: string;
  /** Distinguishes two rows on one page; the panel is `${idPrefix}-panel-${id}`. */
  idPrefix: string;
}) {
  return (
    <div className="edit-tabs" role="tablist" aria-label={label}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          id={`${idPrefix}-tab-${tab.id}`}
          aria-selected={value === tab.id}
          aria-controls={`${idPrefix}-panel-${tab.id}`}
          className={value === tab.id ? 'edit-tabs__tab is-on' : 'edit-tabs__tab'}
          onClick={() => onChange(tab.id)}
        >
          {tab.label}
          {tab.dirty && <span className="edit-tabs__dot" role="img" aria-label="unsaved changes" />}
        </button>
      ))}
    </div>
  );
}

/** The panel a tab row controls, with the ARIA that ties the two together. */
export function EditTabPanel<T extends string>({
  idPrefix,
  value,
  className,
  children,
}: {
  idPrefix: string;
  value: T;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <div
      role="tabpanel"
      id={`${idPrefix}-panel-${value}`}
      aria-labelledby={`${idPrefix}-tab-${value}`}
      className={className}
    >
      {children}
    </div>
  );
}
