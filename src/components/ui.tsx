import type { ReactNode } from "react";

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-border bg-surface p-5 ${className}`}>{children}</section>
  );
}

export function SectionTitle({ step, title, hint }: { step?: number; title: string; hint?: ReactNode }) {
  return (
    <header className="mb-4">
      <h2 className="flex items-center gap-2 text-sm font-semibold tracking-tight">
        {step !== undefined && (
          <span className="grid size-5 place-items-center rounded-full bg-accent-soft text-[11px] font-bold text-accent">
            {step}
          </span>
        )}
        {title}
      </h2>
      {hint && <p className="mt-1 text-xs text-muted">{hint}</p>}
    </header>
  );
}

type Tone = "neutral" | "accent" | "positive" | "warning" | "danger";

const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-muted text-muted",
  accent: "bg-accent-soft text-accent",
  positive: "bg-positive-soft text-positive",
  warning: "bg-warning-soft text-warning",
  danger: "bg-danger-soft text-danger",
};

export function Badge({ tone = "neutral", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function Callout({ tone = "warning", children }: { tone?: Tone; children: ReactNode }) {
  return (
    <div className={`rounded-lg px-3 py-2 text-xs leading-relaxed ${TONE_CLASS[tone]}`}>{children}</div>
  );
}

type ButtonProps = React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" };

export function Button({ variant = "secondary", className = "", ...props }: ButtonProps) {
  const base =
    "inline-flex items-center justify-center gap-1.5 rounded-lg px-3 py-2 text-sm font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50";
  const styles = {
    primary: "bg-accent text-white hover:opacity-90",
    secondary: "border border-border bg-surface hover:bg-surface-muted",
    ghost: "text-muted hover:bg-surface-muted hover:text-foreground",
  } as const;
  return <button className={`${base} ${styles[variant]} ${className}`} {...props} />;
}

export function Field({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export const inputClass =
  "w-full rounded-lg border border-border bg-surface px-3 py-2 text-sm outline-none focus:border-accent";

// Classes completas, nao interpoladas: o Tailwind so gera o que ve no fonte.
const TEXT_TONE: Record<Tone, string> = {
  neutral: "text-foreground",
  accent: "text-accent",
  positive: "text-positive",
  warning: "text-warning",
  danger: "text-danger",
};

export function Stat({ label, value, tone = "neutral" }: { label: string; value: ReactNode; tone?: Tone }) {
  const color = TEXT_TONE[tone];
  return (
    <div className="rounded-lg border border-border bg-surface-muted px-3 py-2">
      <div className="text-[11px] uppercase tracking-wide text-muted">{label}</div>
      <div className={`tabular mt-0.5 text-lg font-semibold ${color}`}>{value}</div>
    </div>
  );
}
