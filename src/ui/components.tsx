import type { ComponentChildren } from 'preact';
import { useEffect } from 'preact/hooks';

export function Stepper(props: { label: string; value: number | null; onChange: (v: number) => void; min?: number }) {
  const min = props.min ?? 0;
  const v = props.value;
  return (
    <div class="stepper" role="group" aria-label={props.label}>
      <button class="btn" aria-label={`${props.label}: minus one`} disabled={v === null || v <= min} onClick={() => props.onChange(Math.max(min, (v ?? 0) - 1))}>
        −
      </button>
      <input
        type="number"
        inputMode="numeric"
        min={min}
        aria-label={props.label}
        value={v ?? ''}
        placeholder="–"
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        onInput={(e) => {
          const raw = (e.currentTarget as HTMLInputElement).value;
          const n = Number.parseInt(raw, 10);
          if (Number.isFinite(n) && n >= min) props.onChange(n);
        }}
      />
      <button class="btn" aria-label={`${props.label}: plus one`} onClick={() => props.onChange((v ?? min) + 1)}>
        +
      </button>
    </div>
  );
}

/** Big score numeral (tap to type) with large − / + buttons beneath. */
export function ScorePad(props: { label: string; value: number | null; onChange: (f: (current: number | null) => number) => void }) {
  const v = props.value;
  return (
    <div class="pad" role="group" aria-label={props.label}>
      <input
        type="number"
        inputMode="numeric"
        min={0}
        aria-label={props.label}
        value={v ?? ''}
        placeholder="–"
        onFocus={(e) => (e.currentTarget as HTMLInputElement).select()}
        onInput={(e) => {
          const n = Number.parseInt((e.currentTarget as HTMLInputElement).value, 10);
          if (Number.isFinite(n) && n >= 0) props.onChange(() => n);
        }}
      />
      <div class="btns">
        <button class="btn" aria-label={`${props.label}: minus one`} disabled={!v} onClick={() => props.onChange((c) => Math.max(0, (c ?? 0) - 1))}>
          −
        </button>
        <button class="btn plus" aria-label={`${props.label}: plus one`} onClick={() => props.onChange((c) => (c ?? 0) + 1)}>
          +
        </button>
      </div>
    </div>
  );
}

export function Seg<T extends string>(props: { value: T; options: [T, string][]; onChange: (v: T) => void; label: string }) {
  return (
    <div class="seg" role="group" aria-label={props.label}>
      {props.options.map(([v, text]) => (
        <button type="button" aria-pressed={props.value === v} onClick={() => props.onChange(v)}>
          {text}
        </button>
      ))}
    </div>
  );
}

export function Sheet(props: { title: string; onClose: () => void; children: ComponentChildren }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && props.onClose();
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, [props.onClose]);
  return (
    <div class="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && props.onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={props.title}>
        <div class="row spread">
          <h2 class="grow">{props.title}</h2>
          <button class="btn ghost" onClick={props.onClose} aria-label="Close">
            ✕
          </button>
        </div>
        {props.children}
      </div>
    </div>
  );
}

/** Ordered list with up/down buttons (reliable on touch, unlike drag-and-drop). */
export function ReorderList<T extends string>(props: {
  items: T[];
  label: (t: T) => string;
  onChange: (items: T[]) => void;
  onRemove?: (t: T) => void;
}) {
  const move = (i: number, d: number) => {
    const next = [...props.items];
    [next[i], next[i + d]] = [next[i + d], next[i]];
    props.onChange(next);
  };
  return (
    <ol class="list reorder">
      {props.items.map((t, i) => (
        <li key={t}>
          <span class="n">{i + 1}</span>
          <span class="label">{props.label(t)}</span>
          <button class="btn icon" aria-label={`Move ${props.label(t)} up`} disabled={i === 0} onClick={() => move(i, -1)}>
            ↑
          </button>
          <button class="btn icon" aria-label={`Move ${props.label(t)} down`} disabled={i === props.items.length - 1} onClick={() => move(i, 1)}>
            ↓
          </button>
          {props.onRemove && (
            <button class="btn icon danger" aria-label={`Remove ${props.label(t)}`} onClick={() => props.onRemove!(t)}>
              ✕
            </button>
          )}
        </li>
      ))}
    </ol>
  );
}

const paths: Record<string, string> = {
  round: 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 3v7l5 3',
  table: 'M4 5h16M4 12h16M4 19h16M9 5v14',
  playoffs: 'M4 4h5v6H4zM4 14h5v6H4zM9 7h4v10H9M13 12h7',
  history: 'M3 12a9 9 0 1 0 3-6.7L3 8M3 3v5h5M12 7v5l3 2',
  setup: 'M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8Zm8.5 4-2 1 .5 2.2-1.8 1.8-2.2-.5-1 2h-2.5l-1-2-2.2.5L6 15.2 6.5 13l-2-1V9.5l2-1L6 6.3 7.8 4.5 10 5l1-2h2.5l1 2 2.2-.5 1.8 1.8-.5 2.2 2 1Z',
};

export function Icon({ name }: { name: keyof typeof paths }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d={paths[name]} />
    </svg>
  );
}

export function download(filename: string, text: string): void {
  downloadBlob(filename, new Blob([text], { type: 'application/json' }));
}

export function downloadBlob(filename: string, blob: Blob): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

export function pickFile(accept: string): Promise<File | null> {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = accept;
    input.onchange = () => resolve(input.files?.[0] ?? null);
    input.click();
  });
}
