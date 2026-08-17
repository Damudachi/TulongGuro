import { useState } from 'react';
import { Link, Navigate } from 'react-router-dom';
import { resumeTo } from '../utils/session';
import {
  Sparkles, ScanLine, ClipboardCheck, BarChart3, WifiOff,
  ShieldCheck, ArrowRight, GraduationCap, Users, Building2, Check, Menu, X,
} from 'lucide-react';
import Logo from '../components/Logo';

// The blob cast from the reference art: capsule bodies, dot eyes, no outlines
// beyond their own fill. Purely decorative, so it is hidden from screen readers.
const BLOBS = [
  { fill: 'bg-magenta-500', h: 'h-24', mood: 'smile' },
  { fill: 'bg-sun-400', h: 'h-32', mood: 'wide' },
  { fill: 'bg-lilac-300', h: 'h-28', mood: 'wink' },
  { fill: 'bg-aqua-400', h: 'h-36', mood: 'smile' },
  { fill: 'bg-lime-400', h: 'h-24', mood: 'wide' },
];

function BlobRow() {
  return (
    <div className="flex items-end justify-center gap-2 sm:gap-3" aria-hidden="true">
      {BLOBS.map((b, i) => (
        <div
          key={i}
          className={`${b.fill} ${b.h} w-14 sm:w-16 rounded-full flex items-start justify-center pt-5 animate-float`}
          style={{ animationDelay: `${i * 0.4}s` }}
        >
          <div className="flex gap-1.5">
            <span className="w-2 h-2 rounded-full bg-brand-chrome" />
            <span className={`w-2 rounded-full bg-brand-chrome ${b.mood === 'wink' ? 'h-0.5 mt-1' : 'h-2'}`} />
          </div>
        </div>
      ))}
    </div>
  );
}

const FEATURES = [
  {
    icon: ScanLine,
    tint: 'bg-sun-200', ring: 'bg-sun-400',
    title: 'Snap and submit',
    body: 'Students photograph handwritten work. Faces and names can be redacted before anything leaves the device.',
  },
  {
    icon: Sparkles,
    tint: 'bg-lilac-100', ring: 'bg-lilac-300',
    title: 'AI does the first pass',
    body: 'Gemini reads the work against your rubric and drafts a score with per-criterion reasoning.',
  },
  {
    icon: ClipboardCheck,
    tint: 'bg-aqua-100', ring: 'bg-aqua-400',
    title: 'Teacher has the last word',
    body: 'Every AI grade lands in a review queue. Nothing reaches a student until a teacher approves it.',
  },
  {
    icon: BarChart3,
    tint: 'bg-magenta-100', ring: 'bg-magenta-500',
    title: 'See the whole class',
    body: 'Skill-level analytics surface which competencies a section is actually struggling with.',
  },
  {
    icon: WifiOff,
    tint: 'bg-lime-100', ring: 'bg-lime-400',
    title: 'Survives a dropped signal',
    body: 'Uploads queue locally when the connection goes and sync themselves the moment it returns.',
  },
  {
    icon: ShieldCheck,
    tint: 'bg-royal-100', ring: 'bg-royal-500',
    title: 'Built for DepEd',
    body: 'Curricula, rubric templates, and competency codes follow the DepEd structure out of the box.',
  },
];

const ROLES = [
  {
    icon: GraduationCap, label: 'For students',
    accent: 'bg-aqua-400', text: 'text-aqua-800',
    points: ['Submit work from any phone', 'See feedback per skill', 'Collect awards as you improve'],
  },
  {
    icon: Users, label: 'For teachers',
    accent: 'bg-royal-500', text: 'text-royal-800',
    points: ['Batch-upload a whole class', 'Review AI drafts in one queue', 'Build rubrics once, reuse forever'],
  },
  {
    icon: Building2, label: 'For admins',
    accent: 'bg-sun-400', text: 'text-sun-800',
    points: ['Onboard teachers and sections', 'Upload the school curriculum', 'Promote rubrics school-wide'],
  },
];

const STEPS = [
  { n: '01', title: 'Set the rubric', body: 'Pick a DepEd template or build your own criteria and weights.' },
  { n: '02', title: 'Collect the work', body: 'Students upload photos, or you batch-upload scans for the section.' },
  { n: '03', title: 'Review the drafts', body: 'AI proposes scores and reasons; you accept, adjust, or reject.' },
  { n: '04', title: 'Act on the data', body: 'Analytics show the competencies that need reteaching next week.' },
];

export default function Landing() {
  const [menuOpen, setMenuOpen] = useState(false);

  /**
   * The way back in.
   *
   * This is the app's front door and the PWA's start_url, so an installed app
   * opens here every single launch. Someone who asked to be kept signed in gets
   * taken to their own screens instead of being shown the marketing page and a
   * log-in button — that button was the entire reason the app asked for a
   * password every morning.
   *
   * Read during render rather than in an effect so the brochure never flashes
   * up first. `replace` keeps it out of history: back from the dashboard should
   * leave the app, not bounce off here and forward again.
   *
   * Signing out clears the session, so this stops applying the moment it should
   * — and /login is always reachable directly for switching accounts.
   */
  const resume = resumeTo();
  if (resume) return <Navigate to={resume} replace />;

  const navLinks = [
    { label: 'Features', href: '#features' },
    { label: 'How it works', href: '#how' },
    { label: 'Who it’s for', href: '#roles' },
  ];

  return (
    <div className="min-h-screen bg-cream-100 text-navy-800 overflow-x-hidden">
      {/* ── Nav ── */}
      <header className="sticky top-0 z-50 bg-cream-100/90 backdrop-blur-md border-b border-navy-700/10">
        <nav className="max-w-6xl mx-auto px-5 sm:px-8 h-18 py-4 flex items-center justify-between">
          <Link to="/" className="flex items-center gap-2.5 font-display text-xl font-extrabold text-navy-700">
            <Logo size="md" />
            TulongGuro
          </Link>

          <div className="hidden md:flex items-center gap-8">
            {navLinks.map((l) => (
              <a key={l.href} href={l.href} className="text-sm font-bold text-navy-600 hover:text-royal-500 transition-colors">
                {l.label}
              </a>
            ))}
            <Link to="/login" className="tg-btn-primary !py-2.5 !px-5">
              Log in <ArrowRight className="w-4 h-4" />
            </Link>
          </div>

          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="md:hidden w-10 h-10 grid place-items-center rounded-xl border-2 border-navy-700/10 text-navy-700"
            aria-label={menuOpen ? 'Close menu' : 'Open menu'}
            aria-expanded={menuOpen}
          >
            {menuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </nav>

        {menuOpen && (
          <div className="md:hidden px-5 pb-5 flex flex-col gap-1 border-t border-navy-700/10 pt-3">
            {navLinks.map((l) => (
              <a
                key={l.href} href={l.href} onClick={() => setMenuOpen(false)}
                className="py-2.5 text-sm font-bold text-navy-600"
              >
                {l.label}
              </a>
            ))}
            <Link to="/login" className="tg-btn-primary mt-2">Log in</Link>
          </div>
        )}
      </header>

      {/* ── Hero ── */}
      <section className="relative tg-dotgrid">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 pt-16 pb-20 sm:pt-24 sm:pb-28 text-center">
          <span className="tg-pill bg-sun-200 text-sun-900 mb-6">
            <Sparkles className="w-3.5 h-3.5" /> AI-assisted, teacher-approved
          </span>

          <h1 className="font-display text-4xl sm:text-6xl lg:text-7xl font-extrabold leading-[1.05] text-navy-700 max-w-4xl mx-auto">
            Grading that gives you{' '}
            <span className="relative inline-block">
              <span className="relative z-10">your evenings</span>
              <span className="absolute inset-x-0 bottom-1 h-4 sm:h-5 bg-sun-400 -rotate-1 z-0" />
            </span>{' '}
            back.
          </h1>

          <p className="mt-6 text-base sm:text-xl text-navy-600 max-w-2xl mx-auto leading-relaxed">
            TulongGuro reads handwritten student work against your rubric, drafts the score,
            and hands it to you for the final call — built for Philippine classrooms, right
            down to the spotty connection.
          </p>

          <div className="mt-9 flex flex-col sm:flex-row gap-3 justify-center">
            <Link to="/register" className="tg-btn-primary text-base !px-8 !py-4">
              Register your school <ArrowRight className="w-4 h-4" />
            </Link>
            <Link to="/login" className="tg-btn-ghost text-base !px-8 !py-4">
              I already have an account
            </Link>
          </div>

          <p className="mt-4 text-xs font-semibold text-navy-400">
            Teacher and student accounts are created by your school — no sign-up needed.
          </p>

          <div className="mt-16">
            <BlobRow />
          </div>
        </div>
      </section>

      {/* ── Features ── */}
      <section id="features" className="bg-white py-20 sm:py-28 rounded-t-[3rem]">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="tg-pill bg-royal-100 text-royal-700 mb-4">What you get</span>
            <h2 className="font-display text-3xl sm:text-5xl font-extrabold text-navy-700">
              Less paperwork. More teaching.
            </h2>
          </div>

          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-5">
            {FEATURES.map((f) => (
              <article key={f.title} className={`${f.tint} rounded-4xl p-7 border-2 border-navy-700/5`}>
                <div className={`${f.ring} w-12 h-12 rounded-2xl grid place-items-center text-white mb-5 shadow-pop`}>
                  <f.icon className="w-6 h-6" />
                </div>
                <h3 className="font-display text-xl font-extrabold text-navy-700 mb-2">{f.title}</h3>
                <p className="text-sm text-navy-600 leading-relaxed">{f.body}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── How it works ── */}
      <section id="how" className="bg-brand-chrome py-20 sm:py-28 text-white">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="tg-pill bg-sheen/15 text-sky-300 mb-4">How it works</span>
            <h2 className="font-display text-3xl sm:text-5xl font-extrabold">
              Four steps, start to finish.
            </h2>
          </div>

          <ol className="grid sm:grid-cols-2 lg:grid-cols-4 gap-5">
            {STEPS.map((s) => (
              <li key={s.n} className="bg-sheen/5 border-2 border-white/10 rounded-4xl p-7">
                <span className="font-display text-4xl font-extrabold text-sun-400">{s.n}</span>
                <h3 className="font-display text-lg font-extrabold mt-3 mb-2">{s.title}</h3>
                <p className="text-sm text-sky-200/80 leading-relaxed">{s.body}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ── Roles ── */}
      <section id="roles" className="bg-white py-20 sm:py-28">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="text-center max-w-2xl mx-auto mb-14">
            <span className="tg-pill bg-aqua-100 text-aqua-800 mb-4">Who it’s for</span>
            <h2 className="font-display text-3xl sm:text-5xl font-extrabold text-navy-700">
              One school, three doors in.
            </h2>
          </div>

          <div className="grid md:grid-cols-3 gap-6">
            {ROLES.map((r) => (
              <article key={r.label} className="tg-card p-8 rounded-4xl">
                <div className={`${r.accent} w-14 h-14 rounded-3xl grid place-items-center text-white mb-6 shadow-pop`}>
                  <r.icon className="w-7 h-7" />
                </div>
                <h3 className={`font-display text-2xl font-extrabold mb-5 ${r.text}`}>{r.label}</h3>
                <ul className="space-y-3">
                  {r.points.map((p) => (
                    <li key={p} className="flex items-start gap-2.5 text-sm text-navy-600">
                      <Check className="w-4 h-4 text-aqua-600 mt-0.5 shrink-0" strokeWidth={3} />
                      {p}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* ── CTA ── */}
      <section className="bg-white pb-20 sm:pb-28">
        <div className="max-w-6xl mx-auto px-5 sm:px-8">
          <div className="bg-royal-500 rounded-[2.5rem] px-8 py-16 sm:py-20 text-center relative overflow-hidden">
            {/* Translucent yellow over blue blends to grey, so the decorative
                circles stay in the white/aqua family that reads clean on royal. */}
            <div className="absolute -top-10 -left-10 w-40 h-40 rounded-full bg-sheen/10" aria-hidden="true" />
            <div className="absolute -bottom-14 -right-8 w-52 h-52 rounded-full bg-aqua-400/25" aria-hidden="true" />

            <div className="relative">
              <h2 className="font-display text-3xl sm:text-5xl font-extrabold text-white max-w-2xl mx-auto leading-tight">
                Ready to hand the first pass to AI?
              </h2>
              <p className="mt-5 text-royal-100 max-w-lg mx-auto">
                Register your school to create the first admin account. Teachers and sections follow from there.
              </p>
              <Link to="/register" className="tg-btn-accent mt-8 text-base !px-8 !py-4">
                Register your school <ArrowRight className="w-4 h-4" />
              </Link>
            </div>
          </div>
        </div>
      </section>

      {/* ── Footer ── */}
      <footer className="bg-white border-t border-slate-200 py-10">
        <div className="max-w-6xl mx-auto px-5 sm:px-8 flex flex-col sm:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-2.5 font-display font-extrabold text-navy-700">
            <Logo size="sm" />
            TulongGuro
          </div>
          <p className="text-xs text-navy-400 font-semibold">
            AI-assisted grading for Philippine schools.
          </p>
          <Link to="/login" className="text-sm font-bold text-royal-500 hover:text-royal-600">
            Log in →
          </Link>
        </div>
      </footer>
    </div>
  );
}
