"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useState, type ReactNode } from "react";
import { Icon, type IconName } from "./icons";

const navigation: Array<{
  href: string;
  label: string;
  shortLabel: string;
  icon: IconName;
}> = [
  { href: "/", label: "Overview", shortLabel: "Home", icon: "home" },
  {
    href: "/portfolio",
    label: "Portfolio ledger",
    shortLabel: "Ledger",
    icon: "portfolio",
  },
  {
    href: "/import",
    label: "Import & reconcile",
    shortLabel: "Import",
    icon: "import",
  },
  {
    href: "/reports",
    label: "Report history",
    shortLabel: "Reports",
    icon: "reports",
  },
  {
    href: "/research",
    label: "Company research",
    shortLabel: "Research",
    icon: "research",
  },
  {
    href: "/paper",
    label: "Paper performance",
    shortLabel: "Paper",
    icon: "paper",
  },
  {
    href: "/settings",
    label: "Settings",
    shortLabel: "Settings",
    icon: "settings",
  },
];

export function AppShell({
  children,
  user,
  localDemo,
}: {
  children: ReactNode;
  user: { displayName: string; email: string };
  localDemo: boolean;
}) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="app-frame">
      <aside className={`sidebar ${menuOpen ? "sidebar-open" : ""}`}>
        <div className="brand-row">
          <Link className="brand" href="/" onClick={() => setMenuOpen(false)}>
            <span className="brand-mark" aria-hidden="true">
              C
            </span>
            <span>
              <strong>Cedar</strong>
              <small>TFSA research desk</small>
            </span>
          </Link>
          <button
            className="icon-button sidebar-close"
            type="button"
            aria-label="Close navigation"
            onClick={() => setMenuOpen(false)}
          >
            <Icon name="close" width={20} height={20} />
          </button>
        </div>

        <div className="mode-pill">
          <span className="mode-dot" />
          Paper & research mode
        </div>

        <nav className="primary-nav" aria-label="Primary navigation">
          {navigation.map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "nav-link active" : "nav-link"}
                onClick={() => setMenuOpen(false)}
              >
                <Icon name={item.icon} width={19} height={19} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>

        <div className="sidebar-schedule">
          <div className="schedule-icon">
            <Icon name="clock" width={18} height={18} />
          </div>
          <div>
            <strong>Calgary schedule</strong>
            <span>Weekdays · 7:30 a.m.</span>
            <span>and 5:30 p.m.</span>
          </div>
        </div>

        <div className="sidebar-footer">
          <span className="avatar">{initials(user.displayName)}</span>
          <div>
            <strong>{user.displayName}</strong>
            <span>{localDemo ? "Local preview" : "Private owner"}</span>
          </div>
          {!localDemo ? (
            <a
              className="signout-link"
              href="/signout-with-chatgpt?return_to=%2F"
            >
              Sign out
            </a>
          ) : null}
        </div>
      </aside>

      {menuOpen ? (
        <button
          className="sidebar-scrim"
          type="button"
          aria-label="Close navigation"
          onClick={() => setMenuOpen(false)}
        />
      ) : null}

      <div className="workspace">
        <div className="mobile-topbar">
          <button
            className="icon-button"
            type="button"
            aria-label="Open navigation"
            onClick={() => setMenuOpen(true)}
          >
            <Icon name="menu" width={21} height={21} />
          </button>
          <Link className="mobile-brand" href="/">
            <span className="brand-mark">C</span>
            <strong>Cedar</strong>
          </Link>
          <span className="avatar avatar-small">{initials(user.displayName)}</span>
        </div>

        <main className="main-content">{children}</main>

        <nav className="mobile-nav" aria-label="Mobile navigation">
          {navigation.slice(0, 5).map((item) => {
            const active =
              item.href === "/"
                ? pathname === "/"
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={active ? "active" : ""}
              >
                <Icon name={item.icon} width={19} height={19} />
                <span>{item.shortLabel}</span>
              </Link>
            );
          })}
        </nav>
      </div>
    </div>
  );
}

function initials(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");
}
