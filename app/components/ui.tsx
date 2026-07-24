import type { ReactNode } from "react";
import { Icon, type IconName } from "./icons";

export function PageHeader({
  eyebrow,
  title,
  description,
  action,
}: {
  eyebrow?: string;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <header className="page-header">
      <div>
        {eyebrow ? <p className="eyebrow">{eyebrow}</p> : null}
        <h1>{title}</h1>
        <p className="page-description">{description}</p>
      </div>
      {action ? <div className="page-action">{action}</div> : null}
    </header>
  );
}

export function Card({
  children,
  className = "",
  as: Tag = "section",
}: {
  children: ReactNode;
  className?: string;
  as?: "section" | "article" | "div";
}) {
  return <Tag className={`card ${className}`}>{children}</Tag>;
}

export function CardHeader({
  title,
  description,
  action,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="card-header">
      <div>
        <h2>{title}</h2>
        {description ? <p>{description}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: "neutral" | "good" | "watch" | "risk" | "info";
}) {
  return <span className={`badge badge-${tone}`}>{children}</span>;
}

export function Metric({
  label,
  value,
  detail,
  icon,
  tone = "default",
}: {
  label: string;
  value: string;
  detail: string;
  icon?: IconName;
  tone?: "default" | "good" | "watch";
}) {
  return (
    <Card className={`metric metric-${tone}`}>
      <div className="metric-topline">
        <span>{label}</span>
        {icon ? <Icon name={icon} width={18} height={18} /> : null}
      </div>
      <strong>{value}</strong>
      <p>{detail}</p>
    </Card>
  );
}

export function Notice({
  title,
  children,
  tone = "info",
  icon = "shield",
}: {
  title: string;
  children: ReactNode;
  tone?: "info" | "warning" | "quiet";
  icon?: IconName;
}) {
  return (
    <div className={`notice notice-${tone}`}>
      <span className="notice-icon">
        <Icon name={icon} width={19} height={19} />
      </span>
      <div>
        <strong>{title}</strong>
        <div>{children}</div>
      </div>
    </div>
  );
}

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon: IconName;
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className="empty-state">
      <span className="empty-icon">
        <Icon name={icon} width={24} height={24} />
      </span>
      <h3>{title}</h3>
      <p>{description}</p>
      {action}
    </div>
  );
}

export function LoadingBlock({ rows = 3 }: { rows?: number }) {
  return (
    <div className="loading-block" role="status" aria-label="Loading">
      {Array.from({ length: rows }).map((_, index) => (
        <span key={index} style={{ width: `${92 - index * 11}%` }} />
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
}: {
  message: string;
  onRetry?: () => void;
}) {
  return (
    <Notice title="Something needs attention" tone="warning" icon="warning">
      <p>{message}</p>
      {onRetry ? (
        <button className="text-button" type="button" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </Notice>
  );
}
