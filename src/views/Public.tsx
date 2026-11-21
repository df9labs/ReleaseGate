import { useEffect, useState, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { CheckCircle2, Gauge, Globe2, MousePointerClick, ShieldCheck, FileDown } from 'lucide-react';
import { api } from '../api';
import { useAuth } from '../auth';

const contact = 'hello@datumfoundrynine.co.uk';

function PublicFrame({ children }: { children: ReactNode }) {
  return (
    <div className="min-h-screen bg-[#050810] text-[#F5FAFF]">
      <header className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-5 sm:px-6">
        <Link to="/" className="flex items-center gap-2 font-extrabold tracking-tight">
          <img src="/favicon.svg" alt="" className="h-7 w-7" />
          ReleaseGate
        </Link>
        <nav className="flex items-center gap-2 text-sm">
          <Link to="/login" className="rounded-lg px-3 py-2 text-[#B0C0D1] hover:text-white">Log in</Link>
          <Link to="/register" className="shipsure-button h-9 px-3">Sign up free</Link>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-4 pb-16 sm:px-6">{children}</main>
      <footer className="mx-auto flex max-w-5xl flex-wrap gap-x-5 gap-y-2 border-t border-white/10 px-4 py-6 text-xs text-[#8C9BAD] sm:px-6">
        <span>© {new Date().getFullYear()} DF9 Labs</span>
        <Link to="/privacy" className="hover:text-white">Privacy</Link>
        <Link to="/terms" className="hover:text-white">Terms</Link>
        <a href={'mailto:' + contact} className="hover:text-white">{contact}</a>
      </footer>
    </div>
  );
}

const features = [
  { icon: Globe2, title: 'Crawls your site', text: 'Reads up to 25 public pages, respecting robots.txt, and checks every link resolves.' },
  { icon: MousePointerClick, title: 'Presses safe buttons', text: 'Replays each page in a sandboxed browser and tries menus, tabs, galleries and cookie banners. It never submits forms or buys anything.' },
  { icon: ShieldCheck, title: 'Checks the basics', text: 'Accessibility, SEO metadata, HTTPS and security headers, privacy notices and release evidence.' },
  { icon: FileDown, title: 'Honest PDF report', text: 'Every pass comes with evidence. Anything it could not safely test is marked untested, with the reason.' },
];

export function Landing() {
  return (
    <PublicFrame>
      <section className="grid gap-10 py-10 md:grid-cols-[1.1fr_0.9fr] md:items-center md:py-16">
        <div>
          <p className="font-mono text-[11px] font-bold uppercase tracking-[0.18em] text-[#FF9B5C]">Release checks for websites</p>
          <h1 className="mt-4 text-4xl font-extrabold leading-[1.02] tracking-[-0.045em] sm:text-6xl">
            Know your site works before your visitors find out.
          </h1>
          <p className="mt-5 max-w-xl text-base leading-7 text-[#B0C0D1]">
            ReleaseGate checks a live website the way a careful tester would: pages, links, buttons, accessibility and
            security headers. Then it tells you plainly what passed, what failed and what it couldn't test.
          </p>
          <div className="mt-7 flex flex-wrap gap-3">
            <Link to="/register" className="shipsure-button h-11 px-5 text-base">Run a free check</Link>
            <Link to="/login" className="inline-flex h-11 items-center rounded-xl border border-white/15 px-5 text-sm text-[#DCE6F0] hover:border-white/30">I have an account</Link>
          </div>
          <p className="mt-4 text-xs text-[#8C9BAD]">Free: 5 checks a day. No card needed.</p>
        </div>
        <div className="rounded-3xl border border-[#FF7A3D]/25 bg-[#0A1020] p-6 shadow-[0_0_80px_rgba(255,122,61,.10)]">
          <div className="flex items-center gap-3">
            <Gauge className="h-8 w-8 text-[#FF9B5C]" />
            <div>
              <p className="text-xs uppercase tracking-[0.16em] text-[#8C9BAD]">Sample result</p>
              <p className="text-2xl font-extrabold">226 checks passed · 0 failed</p>
            </div>
          </div>
          <ul className="mt-5 space-y-2 text-sm text-[#C9D5E1]">
            {['107 navigation and link journeys', '28 usability checks', '27 HTML structure checks', '23 release and security signals'].map((line) => (
              <li key={line} className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-[#78F7CA]" />{line}</li>
            ))}
          </ul>
        </div>
      </section>
      <section className="grid gap-4 sm:grid-cols-2">
        {features.map(({ icon: Icon, title, text }) => (
          <div key={title} className="rounded-2xl border border-white/10 bg-[#0A1020]/70 p-5">
            <Icon className="h-5 w-5 text-[#FF9B5C]" />
            <h2 className="mt-3 font-bold">{title}</h2>
            <p className="mt-1 text-sm leading-6 text-[#B0C0D1]">{text}</p>
          </div>
        ))}
      </section>
      <section className="mt-10 rounded-2xl border border-white/10 p-5 text-sm leading-6 text-[#B0C0D1]">
        <h2 className="font-bold text-white">Only check sites you're allowed to</h2>
        <p className="mt-1">
          ReleaseGate reads public pages only and identifies itself as ReleaseGateHealthcheck. Please only check websites you own or have
          permission to test. It never signs in, submits forms or reaches private networks.
        </p>
      </section>
    </PublicFrame>
  );
}

function Prose({ title, updated, children }: { title: string; updated: string; children: ReactNode }) {
  return (
    <PublicFrame>
      <article className="mx-auto max-w-2xl py-8 text-sm leading-7 text-[#C9D5E1] [&_h2]:mt-8 [&_h2]:text-base [&_h2]:font-bold [&_h2]:text-white [&_li]:ml-5 [&_li]:list-disc">
        <h1 className="text-3xl font-extrabold tracking-tight text-white">{title}</h1>
        <p className="mt-1 text-xs text-[#8C9BAD]">Last updated {updated}</p>
        {children}
      </article>
    </PublicFrame>
  );
}

export function Privacy() {
  return (
    <Prose title="Privacy" updated="20 November 2026">
      <p className="mt-6">ReleaseGate is run by Datum Foundry Nine (DF9 Labs) in the United Kingdom. This page explains what we keep and why.</p>
      <h2>What we store</h2>
      <ul>
        <li>Your account: name, email address and a securely hashed password. We never see or store your password itself.</li>
        <li>Whether you've confirmed your email, and a sign-in session cookie that keeps you logged in for up to 7 days.</li>
        <li>The checks you run: the website address you entered and the results ReleaseGate recorded. Only you (and our administrator, for support and abuse prevention) can see them.</li>
        <li>The bug reports, repair records and versions you create in your workspace. Only you (and our administrator) can see them.</li>
        <li>How many checks you've run today, so we can apply the free allowance.</li>
      </ul>
      <h2>Visitor statistics</h2>
      <p>
        We count visits on our own server, with no third-party analytics or tracking scripts. We keep only daily totals:
        page loads, an estimate of unique visitors, sign-ups and checks run. To estimate unique visitors we combine your
        network address and browser type with a random value that changes every day, and keep that only in memory for
        that day. We never store your address, and we can't use it to identify you.
      </p>
      <h2>Cookies</h2>
      <p>We use one essential cookie to keep you signed in. There are no advertising or analytics cookies.</p>
      <h2>Email</h2>
      <p>We email you only to confirm your address and to reset your password. Emails are sent through Resend. We don't send marketing.</p>
      <h2>Where it's kept and for how long</h2>
      <p>
        Data is kept on our own server in the UK. The website itself is delivered through Netlify. We keep your account and checks until you ask us to
        delete them. Email <a className="text-[#FFAD7D] underline" href={'mailto:' + contact}>{contact}</a> to get a copy of your data or have it deleted.
      </p>
      <h2>Your rights</h2>
      <p>Under UK GDPR you can ask to see, correct or delete your data, or object to how we use it. You can also complain to the Information Commissioner's Office (ico.org.uk).</p>
    </Prose>
  );
}

export function Terms() {
  return (
    <Prose title="Terms of use" updated="20 November 2026">
      <p className="mt-6">These terms apply to the free ReleaseGate service run by Datum Foundry Nine (DF9 Labs).</p>
      <h2>Fair use</h2>
      <ul>
        <li>Only check websites you own or have permission to test.</li>
        <li>Don't try to get around the daily allowance, the private-network protections or other limits, and don't use ReleaseGate to attack or overload a website.</li>
        <li>One account per person, please.</li>
      </ul>
      <h2>The free allowance</h2>
      <p>Each account can run 5 checks a day. There's also a limit across all users, so on busy days checks may be paused until midnight UTC. We may change these limits.</p>
      <h2>Results</h2>
      <p>
        ReleaseGate reports what it observed in a signed-out, sandboxed browser at the time of the check. Its results are a helpful guide, not a guarantee,
        and anything it couldn't safely test is marked untested. The service is provided as-is, while we keep improving it.
      </p>
      <h2>Accounts</h2>
      <p>We may suspend accounts that break these terms. You can ask us to delete your account at any time by emailing {contact}.</p>
      <h2>Contact</h2>
      <p>Questions? Email <a className="text-[#FFAD7D] underline" href={'mailto:' + contact}>{contact}</a>.</p>
    </Prose>
  );
}

export function VerifyEmail() {
  const [params] = useSearchParams();
  const { refresh, user } = useAuth();
  const [state, setState] = useState<{ ok: boolean; message: string } | null>(null);
  useEffect(() => {
    let live = true;
    api.verifyEmail(params.get('token') || '')
      .then((r) => { if (live) setState({ ok: true, message: r.message }); void refresh(); })
      .catch((e: Error) => live && setState({ ok: false, message: e.message }));
    return () => { live = false; };
  }, [params, refresh]);
  return (
    <PublicFrame>
      <section className="mx-auto max-w-md py-16 text-center">
        <h1 className="text-3xl font-extrabold tracking-tight">{state ? (state.ok ? 'Email confirmed' : 'That link didn’t work') : 'Confirming…'}</h1>
        {state && <p className={'mt-4 text-sm ' + (state.ok ? 'text-[#78F7CA]' : 'text-[#FFA0AD]')}>{state.message}</p>}
        {state && (
          <Link to={user ? '/healthcheck' : '/login'} className="shipsure-button mt-6 inline-flex h-11 px-5">
            {user ? 'Run a check' : 'Log in'}
          </Link>
        )}
      </section>
    </PublicFrame>
  );
}
