/** Minimal UI primitives in the LawLink editorial style (teal + hairlines). */
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from "react";

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "ghost" | "danger" }) {
  const styles = {
    primary: "bg-primary text-primary-foreground hover:opacity-90",
    ghost: "bg-transparent text-foreground border border-border hover:bg-muted",
    danger: "bg-destructive text-white hover:opacity-90",
  }[variant];
  return (
    <button
      className={`inline-flex items-center justify-center rounded px-3 py-1.5 text-sm font-medium transition disabled:opacity-50 ${styles} ${className}`}
      {...props}
    />
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className="w-full rounded border border-border bg-card px-3 py-1.5 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary"
      {...props}
    />
  );
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}

export function Card({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`rounded-md border border-border bg-card shadow-sm ${className}`}>{children}</div>
  );
}

const SEVERITY_COLOR: Record<string, string> = {
  BLOCKING: "bg-destructive text-white",
  HIGH: "text-status-red border border-status-red",
  MEDIUM: "text-status-orange border border-status-orange",
  LOW: "text-status-blue border border-status-blue",
  NONE: "text-muted-foreground border border-border",
};
const STATUS_COLOR: Record<string, string> = {
  INTAKE: "text-status-blue border-status-blue",
  PENDING_CONFIRMATION: "text-status-orange border-status-orange",
  CONVERTED: "text-status-green border-status-green",
  DECLINED: "text-muted-foreground border-border",
};

export function Badge({ kind, value }: { kind: "severity" | "status"; value: string }) {
  const map = kind === "severity" ? SEVERITY_COLOR : STATUS_COLOR;
  return (
    <span
      className={`inline-block rounded px-2 py-0.5 text-xs font-medium ${map[value] ?? "border border-border text-muted-foreground"}`}
    >
      {value}
    </span>
  );
}
