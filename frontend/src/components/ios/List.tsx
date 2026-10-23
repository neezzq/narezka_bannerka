import { ChevronRight } from "lucide-react";
import type { ReactNode } from "react";

/** Inset-grouped table section (UITableView.Style.insetGrouped). */
export function ListSection({
  header,
  footer,
  children,
  className = "",
}: {
  header?: ReactNode;
  footer?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`px-4 ${className}`}>
      {header && <h3 className="px-4 pb-1.5 text-footnote uppercase tracking-wide text-label-2">{header}</h3>}
      <div className="overflow-hidden rounded-[var(--radius-group)] bg-surface">{children}</div>
      {footer && <p className="px-4 pt-1.5 text-footnote text-label-2">{footer}</p>}
    </section>
  );
}

export function ListRow({
  icon,
  title,
  subtitle,
  value,
  right,
  onClick,
  chevron,
  destructive,
  children,
  className = "",
}: {
  icon?: ReactNode;
  title?: ReactNode;
  subtitle?: ReactNode;
  value?: ReactNode;
  right?: ReactNode;
  onClick?: () => void;
  chevron?: boolean;
  destructive?: boolean;
  children?: ReactNode;
  className?: string;
}) {
  const Tag = onClick ? "button" : "div";
  return (
    <Tag
      type={onClick ? "button" : undefined}
      onClick={onClick}
      className={`relative flex min-h-11 w-full items-center gap-3 px-4 py-1.5 text-left [&:not(:first-child)]:before:absolute [&:not(:first-child)]:before:top-0 [&:not(:first-child)]:before:right-0 [&:not(:first-child)]:before:left-4 [&:not(:first-child)]:before:h-px [&:not(:first-child)]:before:origin-top [&:not(:first-child)]:before:scale-y-50 [&:not(:first-child)]:before:bg-separator ${
        onClick ? "active:bg-fill-2" : ""
      } ${className}`}
    >
      {icon && <span className="flex shrink-0 items-center">{icon}</span>}
      <span className="min-w-0 flex-1">
        {title && <span className={`block truncate text-body ${destructive ? "text-danger" : ""}`}>{title}</span>}
        {subtitle && <span className="block truncate text-footnote text-label-2">{subtitle}</span>}
        {children}
      </span>
      {value !== undefined && <span className="shrink-0 text-body text-label-2">{value}</span>}
      {right}
      {chevron && <ChevronRight size={18} className="shrink-0 text-label-3" aria-hidden />}
    </Tag>
  );
}

/** A labelled control row used throughout the inspector panels. */
export function FieldRow({ label, children, hint }: { label: ReactNode; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="px-4 py-2">
      <div className="mb-1 flex items-center justify-between text-subhead text-label-2">
        <span>{label}</span>
        {hint}
      </div>
      {children}
    </div>
  );
}
