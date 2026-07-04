import Image from "next/image";
import Link from "next/link";
import { ArrowRight, CheckCircle2, Clock3, HeartPulse, MapPin, ShieldCheck } from "lucide-react";

const productPoints = [
  {
    icon: Clock3,
    title: "Manual timers stay fast",
    body: "Type what you are doing, choose the project, and keep the same timeline available on web and iPhone."
  },
  {
    icon: MapPin,
    title: "Trusted places can suggest time",
    body: "Use location signals conservatively, with review before broad or uncertain activity becomes part of your day."
  },
  {
    icon: HeartPulse,
    title: "Health summaries add context",
    body: "Bring sleep and workout summaries from iOS into the same personal productivity record."
  }
];

export function LandingPage() {
  return (
    <main className="landing-page">
      <nav className="landing-nav" aria-label="Public navigation">
        <Link href="/" className="landing-brand" aria-label="Dayframe home">
          <Image src="/logos/dayframe_logo_banner.png" alt="Dayframe" width={2172} height={724} priority />
        </Link>
        <div>
          <Link href="/login">Log in</Link>
          <Link className="landing-nav-primary" href="/signup">
            Create account
          </Link>
        </div>
      </nav>

      <section className="landing-hero">
        <div className="landing-preview-scene" aria-hidden="true">
          <div className="landing-preview-topline">
            <span>Today</span>
            <strong>6h 40m</strong>
          </div>
          <div className="landing-preview-grid">
            <span>06:00</span>
            <span>09:00</span>
            <span>12:00</span>
            <span>15:00</span>
            <span>18:00</span>
          </div>
          <div className="landing-preview-block block-sleep">
            <strong>Sleep</strong>
            <span>HealthKit summary</span>
          </div>
          <div className="landing-preview-block block-focus">
            <strong>Deep work</strong>
            <span>Project Phoenix</span>
          </div>
          <div className="landing-preview-block block-walk">
            <strong>Walk</strong>
            <span>Workout summary</span>
          </div>
          <div className="landing-preview-block block-review">
            <strong>Review item</strong>
            <span>Suggested from place</span>
          </div>
        </div>

        <div className="landing-hero-copy">
          <h1>Personal time tracking that understands the shape of your day.</h1>
          <p>
            Dayframe combines a fast task timer with iOS location and HealthKit signals, then lets you review
            what should become part of your timeline.
          </p>
          <div className="landing-hero-actions">
            <Link className="landing-primary-action" href="/signup">
              Create account
              <ArrowRight size={18} />
            </Link>
            <Link className="landing-secondary-action" href="/login">
              Log in
            </Link>
          </div>
        </div>
      </section>

      <section className="landing-feature-strip" aria-label="Dayframe features">
        {productPoints.map((point) => {
          const Icon = point.icon;
          return (
            <article key={point.title}>
              <Icon size={22} />
              <h2>{point.title}</h2>
              <p>{point.body}</p>
            </article>
          );
        })}
      </section>

      <section className="landing-assurance">
        <div>
          <ShieldCheck size={24} />
          <h2>Built for a private personal workspace</h2>
        </div>
        <ul>
          <li>
            <CheckCircle2 size={18} />
            Precise location history is workspace-scoped and designed to be deletable.
          </li>
          <li>
            <CheckCircle2 size={18} />
            Automatic entries can remain suggestions until you accept them.
          </li>
          <li>
            <CheckCircle2 size={18} />
            The web app is ready for Vercel and Supabase-backed production auth.
          </li>
        </ul>
      </section>

      <footer className="landing-footer">
        <span>Dayframe</span>
        <Link href="/login">Log in</Link>
      </footer>
    </main>
  );
}
