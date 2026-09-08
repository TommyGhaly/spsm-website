'use client';

/**
 * The event description.
 *
 * The box and its buttons are `components/RichText`, shared with the ministry and
 * gallery Description fields — bold shows as bold, and markdown is still what is
 * stored. What is left here is the field's own furniture: its label, its error,
 * and the body face and measure it is written at.
 */

import { RichText } from '@/components/RichText';

export function BodyField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (value: string) => void;
  error?: string | null;
}) {
  return (
    <div className={error ? 'ee-body ee-body--bad' : 'ee-body'}>
      <RichText
        label={<span className="ee-group__label">The description</span>}
        value={value}
        onChange={onChange}
        className="ee-body__text"
        ariaLabel="The description"
        placeholder="What is this event, and who is it for?"
      />
      {error && <strong className="ee-group__error">{error}</strong>}
    </div>
  );
}
