import { Icon } from "./icons";

export function OwnerLock({
  kind,
  email,
}: {
  kind: "owner_unconfigured" | "forbidden";
  email: string;
}) {
  const unconfigured = kind === "owner_unconfigured";
  return (
    <main className="lock-screen">
      <section className="lock-card">
        <span className="lock-mark">
          <Icon name="shield" width={30} height={30} />
        </span>
        <p className="eyebrow">Private research desk</p>
        <h1>{unconfigured ? "One setup step remains" : "Owner access only"}</h1>
        <p>
          {unconfigured
            ? "The private site is live, but its server-side owner allowlist still needs the OWNER_EMAIL environment value."
            : `The signed-in account (${email}) is not the configured owner of this dashboard.`}
        </p>
        <div className="lock-note">
          <Icon name="shield" width={18} height={18} />
          Wealthsimple and CRA credentials are never requested or stored.
        </div>
        <a
          className="button button-secondary"
          href="/signout-with-chatgpt?return_to=%2F"
        >
          Sign in with a different account
        </a>
      </section>
    </main>
  );
}
