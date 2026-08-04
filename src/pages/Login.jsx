import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, UserCircle, GraduationCap, Eye, EyeOff, Building2, ArrowLeft, ArrowRight } from 'lucide-react';
import { API_URL, apiFetch, setSession } from '../config';

const ROLES = {
  teacher: {
    label: 'Teacher', icon: UserCircle,
    accent: 'text-royal-600', chip: 'bg-royal-500', panel: 'bg-royal-500',
    button: 'bg-royal-500 hover:bg-royal-600 text-white',
    idLabel: 'Email Address', idPlaceholder: 'teacher@deped.gov.ph', idType: 'email',
    home: '/teacher/dashboard',
    blurb: 'Your review queue, sections, and rubrics are waiting.',
  },
  student: {
    label: 'Student', icon: GraduationCap,
    accent: 'text-aqua-700', chip: 'bg-aqua-500', panel: 'bg-aqua-600',
    button: 'bg-aqua-600 hover:bg-aqua-700 text-white',
    idLabel: 'Student ID', idPlaceholder: 'Enter your ID (e.g. RIZAL-001)', idType: 'text',
    home: '/student/dashboard',
    blurb: 'Check your feedback, awards, and what’s due next.',
  },
  admin: {
    label: 'Admin', icon: Building2,
    accent: 'text-navy-700', chip: 'bg-navy-700', panel: 'bg-navy-700',
    button: 'bg-navy-700 hover:bg-navy-800 text-white',
    idLabel: 'Email Address', idPlaceholder: 'admin@school.edu.ph', idType: 'email',
    home: '/admin/teachers',
    blurb: 'Manage teachers, sections, curricula, and rubrics.',
  },
};

// Decorative blob cast, echoing the landing page.
const BLOBS = ['bg-sun-400', 'bg-magenta-500', 'bg-lilac-300', 'bg-lime-400'];

export default function Login() {
  const [role, setRole] = useState('teacher'); // 'teacher' | 'student' | 'admin'
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState(
    // apiFetch redirects here with ?expired=1 when a token is rejected, so
    // the form explains itself instead of looking like it lost the password.
    new URLSearchParams(window.location.search).has('expired')
      ? 'Your session ended. Please sign in again.'
      : ''
  );

  const cfg = ROLES[role];

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const response = await apiFetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: identifier, password, role: role.toUpperCase() })
      });
      const data = await response.json();

      if (data.success) {
        setSession(data.user, data.token);
        navigate(cfg.home);
      } else {
        // The server distinguishes a wrong password from a school that is still
        // awaiting approval or was refused. Blanketing all three as "invalid
        // credentials" sent a pending admin off to reset a password that was
        // never wrong.
        setErrorMsg(data.error || 'Invalid credentials. Please check your details and try again.');
      }
    } catch (err) {
      setErrorMsg('Cannot connect to server.');
    }
  };

  return (
    <div className="min-h-screen bg-cream-100 tg-dotgrid flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 bg-white rounded-[2rem] shadow-card-lg overflow-hidden border-2 border-navy-700/5">

        {/* ── Brand panel ── */}
        <div className={`${cfg.panel} hidden lg:flex flex-col justify-between p-10 text-white transition-colors duration-500 relative overflow-hidden`}>
          <div className="absolute -top-16 -right-12 w-56 h-56 rounded-full bg-white/10" aria-hidden="true" />
          <div className="absolute -bottom-20 -left-16 w-64 h-64 rounded-full bg-white/5" aria-hidden="true" />

          <div className="relative">
            <Link to="/" className="inline-flex items-center gap-2.5 font-display text-2xl font-extrabold">
              <span className="w-11 h-11 rounded-2xl bg-white/15 grid place-items-center">
                <BookOpen className="w-5 h-5" />
              </span>
              TulongGuro
            </Link>
          </div>

          <div className="relative">
            <h2 className="font-display text-4xl font-extrabold leading-tight">
              Welcome back.
            </h2>
            <p className="mt-4 text-white/80 leading-relaxed max-w-xs">{cfg.blurb}</p>

            <div className="flex items-end gap-2.5 mt-12" aria-hidden="true">
              {BLOBS.map((b, i) => (
                <div
                  key={b}
                  className={`${b} w-12 rounded-full flex items-start justify-center pt-4 animate-float`}
                  style={{ height: `${68 + i * 14}px`, animationDelay: `${i * 0.5}s` }}
                >
                  <div className="flex gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-navy-800" />
                    <span className="w-1.5 h-1.5 rounded-full bg-navy-800" />
                  </div>
                </div>
              ))}
            </div>
          </div>

          <p className="relative text-xs font-semibold text-white/60">
            AI-assisted grading for Philippine schools.
          </p>
        </div>

        {/* ── Form ── */}
        <div className="p-7 sm:p-10">
          <Link to="/" className="lg:hidden inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-royal-500 mb-6">
            <ArrowLeft className="w-4 h-4" /> Back
          </Link>

          <h1 className="font-display text-3xl font-extrabold text-navy-700 mb-1.5">Log in</h1>
          <p className="text-sm text-navy-500 mb-7">Choose your role to continue.</p>

          {/* Role switcher */}
          <div className="flex bg-cream-100 p-1.5 rounded-2xl mb-7 gap-1">
            {Object.entries(ROLES).map(([key, r]) => (
              <button
                key={key}
                type="button"
                onClick={() => { setRole(key); setErrorMsg(''); }}
                className={`flex-1 flex items-center justify-center gap-1.5 py-2.5 px-2 rounded-xl text-sm font-bold transition-all ${
                  role === key
                    ? `bg-white shadow-pop ${r.accent}`
                    : 'text-navy-400 hover:text-navy-600'
                }`}
              >
                <r.icon className="w-4 h-4" />
                {r.label}
              </button>
            ))}
          </div>

          {/* autoComplete="off" throughout: shared classroom devices should not
              offer the previous user's credentials to the next one. */}
          <form onSubmit={handleLogin} className="space-y-5" autoComplete="off">
            <div>
              <label className="tg-label">{cfg.idLabel}</label>
              <input
                type={cfg.idType}
                required
                name="tg-identifier"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="tg-input"
                placeholder={cfg.idPlaceholder}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>

            <div>
              <label className="tg-label">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  required
                  name="tg-password"
                  autoComplete="new-password"
                  className="tg-input pr-12"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-navy-300 hover:text-navy-600"
                  aria-label={showPassword ? 'Hide password' : 'Show password'}
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>

            <button
              type="submit"
              className={`w-full rounded-full py-4 font-bold text-sm shadow-pop transition-all
                          active:translate-y-1 active:shadow-none ${cfg.button}`}
            >
              Log in as {cfg.label}
            </button>

            {errorMsg && (
              <div
                role="alert"
                className="p-3.5 bg-red-50 border-2 border-red-200 text-red-600 text-sm rounded-2xl text-center font-bold"
              >
                {errorMsg}
              </div>
            )}
          </form>

          {/* Teacher and student accounts are created for you — only a school
              registers itself, which creates its first admin. */}
          <div className="mt-7 pt-6 border-t-2 border-cream-200">
            {role === 'admin' ? (
              <p className="text-center text-sm text-navy-500">
                School not registered yet?{' '}
                <Link to="/register" className="font-extrabold text-royal-500 hover:text-royal-600 inline-flex items-center gap-1">
                  Register your school <ArrowRight className="w-3.5 h-3.5" />
                </Link>
              </p>
            ) : (
              <p className="text-center text-xs text-navy-400 leading-relaxed font-semibold">
                {role === 'teacher'
                  ? 'Teacher accounts are created by your school admin. Ask them for your login details.'
                  : 'Student accounts are created by your teacher. Ask them for your Student ID.'}
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
