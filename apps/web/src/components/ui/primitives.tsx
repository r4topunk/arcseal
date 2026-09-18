import type * as React from 'react';
import type { Tone } from '@/lib/proposal';
import { cn } from '@/lib/utils';

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('rounded-xl border border-hairline-strong bg-surface', className)} {...props} />;
}

export function CardHeader({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div className={cn('flex flex-col gap-1 border-hairline border-b px-5 py-4', className)} {...props} />
  );
}

export function CardTitle({ className, ...props }: React.HTMLAttributes<HTMLHeadingElement>) {
  return <h2 className={cn('font-semibold text-base', className)} {...props} />;
}

export function CardContent({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn('px-5 py-4', className)} {...props} />;
}

const control =
  'w-full min-w-0 rounded-lg border border-hairline-strong bg-surface text-sm placeholder:text-faint focus-visible:border-accent focus-visible:outline-2 focus-visible:outline-ring/30 disabled:opacity-60 aria-invalid:border-danger';

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cn(control, 'h-10 px-3', className)} {...props} />;
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cn(control, 'min-h-24 px-3 py-2', className)} {...props} />;
}

export function Label({ className, ...props }: React.LabelHTMLAttributes<HTMLLabelElement>) {
  // biome-ignore lint/a11y/noLabelWithoutControl: callers pass htmlFor
  return <label className={cn('font-medium text-sm', className)} {...props} />;
}

/** A labelled form control with an optional hint and an inline error (announced, linked via aria-describedby). */
export function Field({
  label,
  htmlFor,
  hint,
  error,
  aside,
  children,
}: {
  label: string;
  htmlFor: string;
  hint?: React.ReactNode;
  error?: string | null;
  aside?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-baseline justify-between gap-3">
        <Label htmlFor={htmlFor}>{label}</Label>
        {aside}
      </div>
      {children}
      {error ? (
        <p id={`${htmlFor}-error`} className="text-danger text-xs" role="alert">
          {error}
        </p>
      ) : hint ? (
        <p id={`${htmlFor}-hint`} className="text-muted text-xs">
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const toneClass: Record<Tone, string> = {
  accent: 'bg-accent-soft text-accent',
  info: 'bg-info-soft text-info',
  ok: 'bg-ok-soft text-ok',
  warn: 'bg-warn-soft text-warn',
  danger: 'bg-danger-soft text-danger',
  muted: 'bg-surface-2 text-muted',
};

export function Badge({
  tone = 'muted',
  className,
  ...props
}: React.HTMLAttributes<HTMLSpanElement> & { tone?: Tone }) {
  return (
    <span
      data-tone={tone}
      className={cn(
        'inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-0.5 font-medium text-xs',
        toneClass[tone],
        className,
      )}
      {...props}
    />
  );
}

export function Notice({
  tone = 'muted',
  className,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { tone?: Tone }) {
  return <div className={cn('rounded-lg px-4 py-3 text-sm', toneClass[tone], className)} {...props} />;
}

export function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="eyebrow">{label}</span>
      <span className="tnum font-semibold text-2xl tracking-tight">{value}</span>
      {sub ? <span className="text-muted text-xs">{sub}</span> : null}
    </div>
  );
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cn('animate-pulse rounded-md bg-surface-2', className)} />;
}

/** A horizontal meter. `value` and `max` are counts; `mark` draws a threshold line (the quorum). */
export function Meter({
  value,
  max,
  mark,
  label,
  tone = 'accent',
}: {
  value: number;
  max: number;
  mark?: number;
  label: string;
  tone?: 'accent' | 'ok' | 'danger' | 'muted';
}) {
  const pct = max > 0 ? Math.min(100, (value / max) * 100) : 0;
  const markPct = mark !== undefined && max > 0 ? Math.min(100, (mark / max) * 100) : null;
  const fill = { accent: 'bg-accent', ok: 'bg-ok', danger: 'bg-danger', muted: 'bg-faint' }[tone];
  return (
    // biome-ignore lint/a11y/useSemanticElements: a native <meter> cannot draw the quorum mark
    <div
      role="meter"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={value}
      className="relative h-2 w-full overflow-hidden rounded-full bg-surface-2"
    >
      <div className={cn('h-full rounded-full', fill)} style={{ width: `${pct}%` }} />
      {markPct !== null ? (
        <div
          aria-hidden
          className="absolute inset-y-0 w-0.5 bg-foreground/70"
          style={{ left: `${markPct}%` }}
        />
      ) : null}
    </div>
  );
}
