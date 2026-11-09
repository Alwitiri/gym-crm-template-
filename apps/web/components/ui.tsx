"use client";

import Link from "next/link";
import { forwardRef, useEffect, useId, useRef } from "react";
import { ApiError } from "@/lib/api";

export function cx(...c: (string | false | null | undefined)[]) {
  return c.filter(Boolean).join(" ");
}

// ---------- Buttons ----------
type BtnProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger"; size?: "sm" | "md"; busy?: boolean };

const btnBase = "inline-flex items-center justify-center gap-2 rounded-md font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50 whitespace-nowrap";
const btnVariants = {
  primary: "bg-ink text-chalk hover:bg-ink-2",
  secondary: "border border-line bg-surface text-ink hover:bg-surface-2",
  ghost: "text-ink-2 hover:bg-surface-2 hover:text-ink",
  danger: "border border-red/40 bg-surface text-red hover:bg-tint-red",
};
const btnSizes = { sm: "h-8 px-3 text-sm", md: "h-10 px-4" };

export const Button = forwardRef<HTMLButtonElement, BtnProps>(function Button({ variant = "primary", size = "md", busy, className, children, disabled, ...rest }, ref) {
  return (
    <button ref={ref} className={cx(btnBase, btnVariants[variant], btnSizes[size], className)} disabled={disabled || busy} aria-busy={busy || undefined} {...rest}>
      {busy && <span className="size-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" aria-hidden />}
      {children}
    </button>
  );
});

export function LinkButton({ href, variant = "primary", size = "md", className, children }: { href: string; variant?: BtnProps["variant"]; size?: BtnProps["size"]; className?: string; children: React.ReactNode }) {
  return <Link href={href} className={cx(btnBase, btnVariants[variant!], btnSizes[size!], className)}>{children}</Link>;
}

// ---------- Form fields ----------
const fieldCls = "h-10 w-full rounded-md border border-line bg-surface px-3 text-ink placeholder:text-ink-3 focus:border-blue focus:outline-none focus:ring-2 focus:ring-blue/20 aria-[invalid=true]:border-red";

export function Field({ label, hint, error, children, className }: { label: string; hint?: string; error?: string; children: (id: string, describedBy?: string) => React.ReactNode; className?: string }) {
  const id = useId();
  const descId = hint || error ? id + "-d" : undefined;
  return (
    <div className={cx("flex flex-col gap-1.5", className)}>
      <label htmlFor={id} className="text-sm font-medium text-ink-2">{label}</label>
      {children(id, descId)}
      {(error || hint) && <p id={descId} className={cx("text-xs", error ? "text-red" : "text-ink-3")}>{error ?? hint}</p>}
    </div>
  );
}

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string; wrapClass?: string };
export function Input({ label, hint, error, wrapClass, className, ...rest }: InputProps) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapClass}>
      {(id, d) => <input id={id} aria-describedby={d} aria-invalid={!!error || undefined} className={cx(fieldCls, className)} {...rest} />}
    </Field>
  );
}

type SelectProps = React.SelectHTMLAttributes<HTMLSelectElement> & { label: string; hint?: string; error?: string; wrapClass?: string };
export function Select({ label, hint, error, wrapClass, className, children, ...rest }: SelectProps) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapClass}>
      {(id, d) => <select id={id} aria-describedby={d} aria-invalid={!!error || undefined} className={cx(fieldCls, "pr-8", className)} {...rest}>{children}</select>}
    </Field>
  );
}

export function Textarea({ label, hint, error, wrapClass, className, ...rest }: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string; hint?: string; error?: string; wrapClass?: string }) {
  return (
    <Field label={label} hint={hint} error={error} className={wrapClass}>
      {(id, d) => <textarea id={id} aria-describedby={d} className={cx(fieldCls, "h-auto min-h-20 py-2", className)} {...rest} />}
    </Field>
  );
}

/** Rupee amount input; value and onChange are in rupees as text. */
export function MoneyInput(props: Omit<InputProps, "type" | "inputMode">) {
  return (
    <div className="relative">
      <Input inputMode="decimal" autoComplete="off" className="pl-7" {...props} />
      <span className="pointer-events-none absolute bottom-0 left-3 flex h-10 items-center text-ink-3" aria-hidden>₹</span>
    </div>
  );
}

// ---------- Status ----------
const statusStyle: Record<string, string> = {
  ACTIVE: "bg-tint-green text-green",
  PAID: "bg-tint-green text-green",
  CONVERTED: "bg-tint-green text-green",
  SCHEDULED: "bg-tint-blue text-blue",
  ISSUED: "bg-tint-blue text-blue",
  FROZEN: "bg-tint-blue text-blue",
  PENDING_PAYMENT: "bg-tint-yellow text-yellow",
  PARTIALLY_PAID: "bg-tint-yellow text-yellow",
  PROSPECT: "bg-surface-2 text-ink-2",
  EXPIRED: "bg-tint-red text-red",
  CANCELLED: "bg-surface-2 text-ink-3",
  LOST: "bg-surface-2 text-ink-3",
  VOID: "bg-surface-2 text-ink-3",
};
const statusLabel: Record<string, string> = {
  PENDING_PAYMENT: "Awaiting payment", PARTIALLY_PAID: "Part paid", PROSPECT: "Not started", ISSUED: "Unpaid",
};
export function Status({ value, className }: { value: string; className?: string }) {
  const label = statusLabel[value] ?? value.charAt(0) + value.slice(1).toLowerCase().replace(/_/g, " ");
  return <span className={cx("inline-flex h-6 items-center rounded px-2 text-xs font-semibold", statusStyle[value] ?? "bg-surface-2 text-ink-2", className)}>{label}</span>;
}

// ---------- Layout bits ----------
export function PageHeader({ title, description, actions }: { title: string; description?: string; actions?: React.ReactNode }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-4">
      <div>
        <h1 className="text-3xl">{title}</h1>
        {description && <p className="mt-1 max-w-prose text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

export function Panel({ title, actions, children, className, padded = true }: { title?: string; actions?: React.ReactNode; children: React.ReactNode; className?: string; padded?: boolean }) {
  return (
    <section className={cx("rounded-lg border border-line bg-surface", className)}>
      {title && (
        <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-lg">{title}</h2>
          {actions}
        </header>
      )}
      <div className={padded ? "p-4" : ""}>{children}</div>
    </section>
  );
}

export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
      <p className="font-cond text-xl text-ink-2">{title}</p>
      {children && <div className="max-w-sm text-sm text-ink-3">{children}</div>}
    </div>
  );
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof ApiError || error instanceof Error ? error.message : String(error);
  return <p role="alert" className="rounded-md border border-red/30 bg-tint-red px-3 py-2 text-sm text-red">{msg}</p>;
}

export function Skeleton({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-2 p-4" aria-hidden>
      {Array.from({ length: rows }).map((_, i) => <div key={i} className="h-9 animate-pulse rounded bg-surface-2" />)}
    </div>
  );
}

// ---------- Dialog ----------
export function Dialog({ open, onClose, title, children, wide }: { open: boolean; onClose: () => void; title: string; children: React.ReactNode; wide?: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => { if (e.target === ref.current) onClose(); }}
      className={cx("m-auto w-[calc(100%-2rem)] rounded-lg border border-line bg-surface p-0 text-ink shadow-xl", wide ? "max-w-2xl" : "max-w-lg")}
    >
      {open && (
        <div className="flex max-h-[85vh] flex-col">
          <header className="flex items-center justify-between border-b border-line px-5 py-3">
            <h2 className="text-xl">{title}</h2>
            <button onClick={onClose} className="rounded p-1 text-ink-3 hover:bg-surface-2 hover:text-ink" aria-label="Close">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 6l12 12M18 6L6 18" /></svg>
            </button>
          </header>
          <div className="overflow-y-auto p-5">{children}</div>
        </div>
      )}
    </dialog>
  );
}

// ---------- Table ----------
export function Table({ children }: { children: React.ReactNode }) {
  return <div className="overflow-x-auto"><table className="w-full border-collapse text-left text-sm">{children}</table></div>;
}
export const Th = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <th scope="col" className={cx("border-b border-line px-4 py-2.5 text-xs font-semibold text-ink-3", className)}>{children}</th>
);
export const Td = ({ children, className }: { children?: React.ReactNode; className?: string }) => (
  <td className={cx("border-b border-line px-4 py-3 align-middle", className)}>{children}</td>
);

export function Pager({ page, pageSize, total, onPage }: { page: number; pageSize: number; total: number; onPage: (p: number) => void }) {
  const pages = Math.max(1, Math.ceil(total / pageSize));
  if (total === 0) return null;
  return (
    <div className="flex items-center justify-between px-4 py-3 text-sm text-ink-2">
      <span>{(page - 1) * pageSize + 1}–{Math.min(page * pageSize, total)} of {total}</span>
      <div className="flex gap-2">
        <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</Button>
        <Button size="sm" variant="secondary" disabled={page >= pages} onClick={() => onPage(page + 1)}>Next</Button>
      </div>
    </div>
  );
}

// ---------- Toast ----------
export function Toast({ message, onDone }: { message: string | null; onDone: () => void }) {
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(onDone, 3500);
    return () => clearTimeout(t);
  }, [message, onDone]);
  if (!message) return null;
  return (
    <div role="status" className="fixed bottom-5 left-1/2 z-50 -translate-x-1/2 rounded-md bg-ink px-4 py-2.5 text-sm font-medium text-chalk shadow-lg">
      {message}
    </div>
  );
}

// ---------- Tabs ----------
export function Tabs<T extends string>({ value, onChange, items, className }: { value: T; onChange: (v: T) => void; items: [T, string][]; className?: string }) {
  return (
    <div role="tablist" className={cx("mb-5 flex gap-1 overflow-x-auto border-b border-line", className)}>
      {items.map(([k, label]) => (
        <button key={k} role="tab" aria-selected={value === k} onClick={() => onChange(k)}
          className={cx("-mb-px whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-semibold", value === k ? "border-ink text-ink" : "border-transparent text-ink-3 hover:text-ink")}>
          {label}
        </button>
      ))}
    </div>
  );
}

/** A labelled on/off switch. */
export function Toggle({ label, hint, checked, onChange }: { label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-start justify-between gap-4 py-2">
      <span><span className="block font-medium">{label}</span>{hint && <span className="block text-sm text-ink-3">{hint}</span>}</span>
      <input type="checkbox" role="switch" checked={checked} onChange={(e) => onChange(e.target.checked)} className="peer sr-only" />
      <span aria-hidden className={cx("relative mt-0.5 h-6 w-10 shrink-0 rounded-full transition-colors peer-focus-visible:ring-2 peer-focus-visible:ring-blue/40", checked ? "bg-green" : "bg-line")}>
        <span className={cx("absolute top-0.5 size-5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </label>
  );
}

/** One number on a report: label, big figure, optional note. */
export function Stat({ label, value, note, tone }: { label: string; value: React.ReactNode; note?: React.ReactNode; tone?: "green" | "red" }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-4 py-4">
      <p className="text-sm text-ink-2">{label}</p>
      <p className={cx("mt-0.5 font-cond text-3xl font-semibold", tone === "green" && "text-green", tone === "red" && "text-red")}>{value}</p>
      {note && <p className="mt-0.5 text-xs text-ink-3">{note}</p>}
    </div>
  );
}
