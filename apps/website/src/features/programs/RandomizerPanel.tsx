'use client';

import { useEffect, useState } from 'react';
import {
  MAX_RANDOM_COUNT,
  randomTotal,
  type RandomizerSettings,
} from '@spsm/shared';
import { Icon } from '@/components/Icon';

/**
 * The randomizer's controls, at the top of a page's Photos tab.
 *
 * On, a page draws a fresh random handful of everything beneath it on every visit,
 * as a random run of grids and wheels — see `gallery/randomizer.ts`. The blocks an
 * administrator arranged by hand stay stored and come back the moment it is
 * turned off; nothing here deletes them.
 *
 * Numbers are committed on blur or Enter, not on each keystroke: typing "40" is
 * otherwise a write for "4" and then another for "40", and the page reshuffles
 * under the cursor in between.
 */
export function RandomizerPanel({
  settings,
  levels,
  blacklisted,
  busy,
  onChange,
  onReshuffle,
  onBlacklist,
}: {
  settings: RandomizerSettings;
  /** The levels directly inside this page, for per-child counts. */
  levels: readonly { id: string; title: string }[];
  /** How many pictures the program's blacklist holds. */
  blacklisted: number;
  busy: boolean;
  onChange: (next: RandomizerSettings) => void;
  onReshuffle: () => void;
  onBlacklist: () => void;
}) {
  const perChildOn = Object.keys(settings.perChild).length > 0;

  return (
    <div className="inspector__group randomizer">
      <div className="designer__row">
        <p className="designer__label">Randomize this page</p>
        <div className="chips" role="group" aria-label="Randomize this page">
          {(
            [
              [true, 'On'],
              [false, 'Off'],
            ] as const
          ).map(([option, label]) => (
            <button
              key={label}
              type="button"
              className={`chip${settings.enabled === option ? ' is-on' : ''}`}
              aria-pressed={settings.enabled === option}
              disabled={busy}
              onClick={() => onChange({ ...settings, enabled: option })}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {!settings.enabled ? (
        <p className="inspector__note">
          The page shows the blocks you arranged. Turn this on for a fresh random mix
          of everything inside it — and a fresh layout of grids and wheels — on every
          visit.
        </p>
      ) : (
        <>
          <CountField
            label="How many pictures"
            value={perChildOn ? randomTotal(settings) : settings.count}
            disabled={busy || perChildOn}
            onCommit={(count) => onChange({ ...settings, count: count ?? settings.count })}
          />
          {perChildOn && (
            <p className="inspector__note">
              Exactly {randomTotal(settings)}: the counts below replace this number.
              Clear them all to go back to a total from anywhere inside.
            </p>
          )}

          {levels.length > 0 && (
            <fieldset className="randomizer__shares">
              <legend>From each part (optional)</legend>
              {levels.map((level) => (
                <CountField
                  key={level.id}
                  label={level.title}
                  value={settings.perChild[level.id] ?? null}
                  placeholder="—"
                  disabled={busy}
                  onCommit={(count) => {
                    const perChild = { ...settings.perChild };
                    if (count && count > 0) perChild[level.id] = count;
                    else delete perChild[level.id];
                    onChange({ ...settings, perChild });
                  }}
                />
              ))}
            </fieldset>
          )}

          <p className="randomizer__actions">
            <button type="button" className="button button--quiet" onClick={onReshuffle}>
              <Icon name="redo" size={15} />
              Shuffle again
            </button>
            <button type="button" className="button button--quiet" onClick={onBlacklist}>
              <Icon name="close" size={15} />
              Never pick… {blacklisted > 0 && <b>({blacklisted})</b>}
            </button>
          </p>
          <p className="inspector__note">
            Visitors get a new mix on every visit. <strong>Never pick</strong> is one list
            for the whole ministry: a picture on it is left out of every randomized page,
            and still shows on the day it was filed under and in the presentation.
          </p>
        </>
      )}
    </div>
  );
}

/** A number, committed on blur or Enter. Empty commits `null`. */
function CountField({
  label,
  value,
  placeholder,
  disabled,
  onCommit,
}: {
  label: string;
  value: number | null;
  placeholder?: string;
  disabled: boolean;
  onCommit: (value: number | null) => void;
}) {
  const [text, setText] = useState(value === null ? '' : String(value));
  useEffect(() => setText(value === null ? '' : String(value)), [value]);

  const commit = () => {
    const trimmed = text.trim();
    const parsed = trimmed === '' ? null : Math.round(Number(trimmed));
    const next =
      parsed === null || !Number.isFinite(parsed)
        ? null
        : Math.max(0, Math.min(MAX_RANDOM_COUNT, parsed));
    if (next === value) {
      setText(value === null ? '' : String(value));
      return;
    }
    onCommit(next);
  };

  return (
    <label className="inspector__field randomizer__count">
      <span>{label}</span>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        max={MAX_RANDOM_COUNT}
        value={text}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(change) => setText(change.target.value)}
        onBlur={commit}
        onKeyDown={(key) => {
          if (key.key === 'Enter') (key.target as HTMLInputElement).blur();
        }}
      />
    </label>
  );
}
