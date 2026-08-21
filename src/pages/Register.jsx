import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, UploadCloud, X, Image as ImageIcon, ArrowLeft, Clock, Pipette,
  CheckCircle2, AlertTriangle, Loader2, FileText, ShieldCheck } from 'lucide-react';
import { API_URL, apiFetch } from '../config';
import { ADMIN_EMAIL_DOMAIN, localPartOf, buildAccountEmail } from '../constants/accountEmails';

/**
 * Suggested school colours — the admin can still pick any hex via the picker
 * below. Spread around the colour wheel so a school likely to have a red, a
 * maroon or a burnt-orange banner (common on Philippine school seals) does not
 * have to reach for the free-form picker just to get near their real colour.
 */
const COLOR_PRESETS = [
  '#DC2626', // red
  '#E11D48', // rose
  '#EE2F80', // pink
  '#EA580C', // orange
  '#D97706', // amber
  '#C9A417', // gold
  '#7E9410', // olive
  '#16A34A', // green
  '#059669', // emerald
  '#2A9D9A', // teal
  '#0E7490', // cyan
  '#4A9BC9', // sky
  '#2B59C3', // blue
  '#0A2463', // navy
  '#7C3AED', // violet
  '#8E5CAF', // purple
  '#831843', // maroon
  '#475569', // slate
];

/** Fallback swatch when the school picks no colour of its own. */
const DEFAULT_BRAND = '#2B59C3';

export default function Register() {
  // `email` holds only the part before the @. The domain is fixed and rendered
  // as a suffix on the field rather than left to be typed: an admin account has
  // to sit on @admin.com, and a form that accepts anything and refuses it on
  // submit teaches the rule one rejection at a time.
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    schoolName: '',
    // A mailbox that actually receives mail, unlike the @admin.com login above
    // it. This is the only address on the record anyone can reach the school on.
    contactEmail: '',
  });
  const adminEmail = buildAccountEmail(formData.email, 'ADMIN');

  // ── Does this school exist? ──
  // The DepEd School ID is checked against the published Masterlist of Schools
  // while the form is still open, so a transposed digit is caught here rather
  // than on submit, and a school that genuinely is not on the list is shown the
  // document upload before it has typed a password.
  const [schoolId, setSchoolId] = useState('');
  const [lookup, setLookup] = useState(null);   // null | { state, school }
  const [proof, setProof] = useState(null);
  // Set when the server refuses for a missing document — the belt to the
  // lookup's braces, for the case where the ID was never looked up at all.
  const [proofRequired, setProofRequired] = useState(false);
  // Branding is optional — a school with neither falls back to the initials
  // placeholder and the default palette.
  const [logo, setLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [brandColor, setBrandColor] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  // Set once the school is registered and awaiting operator approval.
  const [submitted, setSubmitted] = useState(null);

  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);

  // Debounced so typing a six-digit ID is one lookup, not six. `cancelled`
  // guards against an earlier, slower response landing after a later one and
  // reporting the wrong school.
  useEffect(() => {
    const id = schoolId.replace(/\D/g, '');
    if (id.length < 5) return undefined;
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (!cancelled) setLookup({ state: 'checking' });
      try {
        const res = await apiFetch(`${API_URL}/api/auth/school-lookup?schoolId=${id}`);
        const data = await res.json();
        if (cancelled) return;
        if (!data.success) return setLookup(null);
        if (data.verdict === 'NO_MASTERLIST') setLookup({ state: 'unchecked' });
        else if (data.verdict === 'FOUND') setLookup({ state: data.alreadyRegistered ? 'taken' : 'found', school: data.school });
        else setLookup({ state: 'missing' });
      } catch {
        // A lookup that could not run must not read as "your school isn't
        // real" — the server checks again on submit, so silence is correct.
        if (!cancelled) setLookup(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [schoolId]);

  // Clearing the field has to clear its verdict too, or a stale "✓ matched"
  // sits under an empty box.
  const handleSchoolIdChange = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    setSchoolId(digits);
    if (digits.length < 5) setLookup(null);
    setProofRequired(false);
  };

  const handleProofPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 10 * 1024 * 1024) return setError('The document must be under 10MB.');
    setError('');
    setProof(file);
  };

  // The document is asked for only when the ID is not on the list, which is the
  // one case a human has to judge by hand.
  const showProofField = lookup?.state === 'missing' || proofRequired;

  const handleLogoPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) return setError('The logo must be an image file.');
    if (file.size > 2 * 1024 * 1024) return setError('Logo must be under 2MB.');
    setError('');
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogo(file);
    setLogoPreview(URL.createObjectURL(file));
  };

  const clearLogo = () => {
    if (logoPreview) URL.revokeObjectURL(logoPreview);
    setLogo(null);
    setLogoPreview(null);
  };

  const handleRegister = async (e) => {
    e.preventDefault();
    if (isSubmitting) return;
    setError('');
    setIsSubmitting(true);
    try {
      const body = new FormData();
      // The full address, not the local part the field holds.
      Object.entries({ ...formData, email: adminEmail }).forEach(([k, v]) => body.append(k, v));
      body.append('depedSchoolId', schoolId);
      if (brandColor) body.append('brandColor', brandColor);
      if (logo) body.append('logo', logo);
      if (proof) body.append('proof', proof);

      const response = await apiFetch(`${API_URL}/api/auth/register`, { method: 'POST', body });
      const data = await response.json();
      // The server refuses a School ID it cannot find unless a document came
      // with it. Reveal the field rather than only saying so, so the fix is in
      // front of them instead of described to them.
      if (!data.success && data.code === 'PROOF_REQUIRED') setProofRequired(true);
      if(data.success) {
        // No session is stored: the account exists but cannot sign in until a
        // TulongGuro operator approves the school, so sending them to the admin
        // area would only bounce them straight back out at the login gate.
        setSubmitted({
          school: data.school?.name || formData.schoolName,
          email: adminEmail,
          verification: data.school?.verification || null,
        });
      } else {
        setError(data.error || 'Registration failed. Please try again.');
      }
    } catch {
      setError('Network Error. Please check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // ── Registered, awaiting approval ──
  // A dead end on purpose: there is nothing they can do in the app until a
  // TulongGuro operator approves the school, and a "Go to dashboard" button
  // would only send them to a login that refuses them.
  if (submitted) {
    return (
      <div className="min-h-screen bg-cream-100 tg-dotgrid flex items-center justify-center p-4 sm:p-6">
        <div className="w-full max-w-lg bg-white rounded-[2rem] shadow-card-lg border-2 border-navy-700/5 overflow-hidden">
          <div className="bg-aqua-500 px-8 py-10 text-white text-center">
            <span className="w-14 h-14 rounded-3xl bg-sheen/20 grid place-items-center mx-auto mb-4">
              <Clock className="w-7 h-7" />
            </span>
            <h1 className="font-display text-2xl font-extrabold mb-1.5">Registration received</h1>
            <p className="text-white/80 text-sm">{submitted.school}</p>
          </div>
          <div className="p-8 space-y-4">
            <p className="text-sm text-navy-700 leading-relaxed">
              Your school is being reviewed by the TulongGuro team. We check every new
              school before opening it up, so this usually takes about one working day.
            </p>
            {/* A school whose ID matched has already cleared the automatic
                check, and saying so beats leaving every registrant with the
                same unqualified wait. */}
            {submitted.verification === 'MATCHED' && (
              <div className="flex items-start gap-2 p-3 rounded-2xl bg-emerald-50 border-2 border-emerald-200">
                <ShieldCheck className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-emerald-800">
                  Your DepEd School ID matched the Masterlist of Schools, so the automatic
                  check has already passed. A person just needs to confirm it.
                </p>
              </div>
            )}
            {submitted.verification === 'NOT_FOUND' && (
              <div className="flex items-start gap-2 p-3 rounded-2xl bg-amber-50 border-2 border-amber-200">
                <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                <p className="text-xs font-semibold text-amber-800">
                  Your School ID wasn't in our copy of the DepEd masterlist, so someone will
                  read the document you attached. This one can take a little longer.
                </p>
              </div>
            )}
            <div className="bg-cream-100 border-2 border-navy-700/5 rounded-2xl p-4">
              <p className="text-xs font-bold text-navy-500 uppercase tracking-wider mb-1">What happens next</p>
              <p className="text-sm text-navy-600 leading-relaxed">
                Once approved, sign in at the login page with <strong>{submitted.email}</strong> and
                the password you just chose. Your admin account and school are already saved —
                nothing needs to be set up again.
              </p>
            </div>
            <Link to="/login"
              className="block text-center w-full py-3 rounded-2xl bg-brand-chrome text-white font-extrabold hover:bg-ink-800 transition-colors">
              Go to sign in
            </Link>
            <Link to="/" className="block text-center text-sm font-bold text-navy-500 hover:text-royal-500">
              Back to home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-cream-100 tg-dotgrid flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-royal-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        <div className="bg-white rounded-[2rem] shadow-card-lg overflow-hidden border-2 border-navy-700/5">
          {/* ── Header ── */}
          <div className="relative bg-brand-chrome px-8 py-10 text-white text-center overflow-hidden">
            <div className="absolute -top-12 -right-10 w-44 h-44 rounded-full bg-royal-500/30" aria-hidden="true" />
            <div className="absolute -bottom-16 -left-12 w-52 h-52 rounded-full bg-aqua-400/15" aria-hidden="true" />
            <div className="relative">
              <span className="w-14 h-14 rounded-3xl bg-sheen/15 grid place-items-center mx-auto mb-4">
                <BookOpen className="w-7 h-7" />
              </span>
              <h1 className="font-display text-3xl font-extrabold mb-1.5">Register Your School</h1>
              <p className="text-white/70 text-sm">Creates your school and its first admin account</p>
            </div>
          </div>

          <div className="p-7 sm:p-9">
            <div className="bg-sky-100 border-2 border-sky-200 rounded-2xl p-4 mb-6 text-xs text-navy-700 leading-relaxed">
              As the school admin you'll create teacher accounts, publish the curriculum for each grade
              level and subject, and set the rubrics your teachers grade with. Teachers and students
              can't sign themselves up — you create teachers, and they create their students.
              This first account is also the school's <strong>super admin</strong>: the only one who
              can add or remove other admins later.
            </div>

            <form onSubmit={handleRegister} className="space-y-5" autoComplete="off">
              <div>
                <label className="tg-label">Your Full Name</label>
                <input
                  type="text"
                  required
                  className="tg-input"
                  placeholder="Juan Dela Cruz"
                  onChange={(e) => setFormData({...formData, name: e.target.value})}
                />
              </div>

              <div>
                <label className="tg-label">Admin Email Address</label>
                {/* Split field: they type the name, the domain is shown and
                    cannot be changed. localPartOf() cuts at any @ they type or
                    paste, so pasting a whole address does the obvious thing
                    instead of producing "principal@admin.com@admin.com". */}
                <div className="flex items-stretch rounded-2xl border-2 border-navy-700/10 bg-white overflow-hidden focus-within:border-royal-400 transition-colors">
                  <input
                    type="text"
                    required
                    value={formData.email}
                    inputMode="email"
                    autoComplete="off"
                    aria-describedby="admin-email-hint"
                    className="flex-1 min-w-0 px-4 py-3 outline-none text-navy-700 font-semibold"
                    placeholder="principal"
                    onChange={(e) => setFormData({ ...formData, email: localPartOf(e.target.value) })}
                  />
                  <span className="shrink-0 px-3 grid place-items-center bg-cream-100 border-l-2 border-navy-700/10 text-sm font-extrabold text-navy-500 select-none">
                    @{ADMIN_EMAIL_DOMAIN}
                  </span>
                </div>
                <p id="admin-email-hint" className="text-xs text-navy-400 mt-1.5 font-semibold">
                  Every admin account signs in on @{ADMIN_EMAIL_DOMAIN}. Teachers you create later
                  get @teacher.edu.ph addresses.
                </p>
              </div>

              <div>
                <label className="tg-label">School Name</label>
                <input
                  type="text"
                  required
                  className="tg-input"
                  placeholder="Manila Science High School"
                  value={formData.schoolName}
                  onChange={(e) => setFormData({...formData, schoolName: e.target.value})}
                />
              </div>

              {/* ── DepEd School ID ──
                  The field that makes registration cost something. Everything
                  else on this form is free to invent; this one has to name a
                  school DepEd has actually recorded. */}
              <div>
                <label className="tg-label">DepEd School ID</label>
                <input
                  type="text"
                  required
                  inputMode="numeric"
                  className="tg-input tracking-[0.2em] font-mono"
                  placeholder="136353"
                  value={schoolId}
                  aria-describedby="school-id-hint"
                  onChange={(e) => handleSchoolIdChange(e.target.value)}
                />

                {lookup?.state === 'checking' && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-navy-400 mt-1.5">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" /> Checking DepEd records…
                  </p>
                )}

                {lookup?.state === 'found' && (
                  <div className="flex items-start gap-2 mt-2 p-3 rounded-2xl bg-emerald-50 border-2 border-emerald-200">
                    <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0 mt-0.5" />
                    <div className="min-w-0 text-xs">
                      <p className="font-extrabold text-emerald-800">{lookup.school.name}</p>
                      {(lookup.school.division || lookup.school.region) && (
                        <p className="text-emerald-700 font-semibold">
                          {[lookup.school.division, lookup.school.region].filter(Boolean).join(' · ')}
                        </p>
                      )}
                      {/* The masterlist's spelling is the one an operator will
                          compare against, so make taking it a single tap
                          rather than something to retype. */}
                      {formData.schoolName.trim() !== lookup.school.name && (
                        <button type="button"
                          onClick={() => setFormData({ ...formData, schoolName: lookup.school.name })}
                          className="mt-1 font-extrabold text-emerald-700 underline hover:text-emerald-900">
                          Use this name
                        </button>
                      )}
                    </div>
                  </div>
                )}

                {lookup?.state === 'taken' && (
                  <div className="flex items-start gap-2 mt-2 p-3 rounded-2xl bg-amber-50 border-2 border-amber-200 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="font-semibold text-amber-800">
                      <strong className="font-extrabold">{lookup.school.name}</strong> is already on TulongGuro.
                      Ask your school's admin to create your account instead of registering again.
                    </p>
                  </div>
                )}

                {lookup?.state === 'missing' && (
                  <div className="flex items-start gap-2 mt-2 p-3 rounded-2xl bg-amber-50 border-2 border-amber-200 text-xs">
                    <AlertTriangle className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
                    <p className="font-semibold text-amber-800">
                      We couldn't find this ID in the DepEd masterlist. Double-check it — and if it's
                      right, attach a permit below and we'll review your school by hand.
                    </p>
                  </div>
                )}

                <p id="school-id-hint" className="text-xs text-navy-400 mt-1.5 font-semibold">
                  The six-digit number on your school's DepEd records. We check it against the DepEd
                  Masterlist of Schools so real schools get through quickly.
                </p>
              </div>

              {/* Shown only when the ID isn't on the list — the one case that
                  needs a person to look at it. */}
              {showProofField && (
                <div className="p-4 rounded-2xl bg-cream-100 border-2 border-navy-700/10">
                  <label className="tg-label">Proof your school exists</label>
                  <p className="text-xs text-navy-500 font-semibold mb-3 leading-relaxed">
                    A DepEd Government Permit, Certificate of Recognition, or similar document.
                    New, recently renamed and private schools often aren't in our copy of the list yet.
                  </p>
                  {proof ? (
                    <div className="flex items-center gap-2 p-3 rounded-xl bg-white border-2 border-navy-700/10">
                      <FileText className="w-4 h-4 text-navy-500 shrink-0" />
                      <span className="text-xs font-bold text-navy-700 truncate flex-1 min-w-0">{proof.name}</span>
                      <button type="button" onClick={() => setProof(null)} title="Remove document"
                        className="shrink-0 text-navy-400 hover:text-red-600">
                        <X className="w-4 h-4" />
                      </button>
                    </div>
                  ) : (
                    <label className="flex items-center justify-center gap-2 p-4 border-2 border-dashed border-navy-300 rounded-xl cursor-pointer hover:border-royal-400 hover:bg-royal-50 transition-colors">
                      <UploadCloud className="w-4 h-4 text-navy-400" />
                      <span className="text-xs font-bold text-navy-500">Attach document</span>
                      <input type="file" accept="image/*,.pdf,.docx" className="hidden" onChange={handleProofPick} />
                    </label>
                  )}
                  <p className="text-[10px] text-navy-400 mt-1.5 font-semibold">Photo, PDF or Word — max 10MB</p>
                </div>
              )}

              {/* ── Contact email ──
                  Separate from the sign-in address above, which sits on a
                  domain with no mailbox behind it. This is how we reach the
                  school while reviewing it. */}
              <div>
                <label className="tg-label">School Contact Email</label>
                <input
                  type="email"
                  required
                  className="tg-input"
                  placeholder="office@yourschool.deped.gov.ph"
                  value={formData.contactEmail}
                  aria-describedby="contact-email-hint"
                  onChange={(e) => setFormData({ ...formData, contactEmail: e.target.value })}
                />
                <p id="contact-email-hint" className="text-xs text-navy-400 mt-1.5 font-semibold">
                  A real inbox we can reach you on while we review your school — not the
                  @{ADMIN_EMAIL_DOMAIN} sign-in above, which is a username rather than a mailbox.
                </p>
              </div>

              <div>
                <label className="tg-label">Password</label>
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    required
                    className="tg-input pr-12"
                    placeholder="••••••••"
                    onChange={(e) => setFormData({...formData, password: e.target.value})}
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

              {/* ── Optional branding ── */}
              <div className="pt-5 border-t-2 border-cream-200">
                <div className="flex items-baseline justify-between mb-4">
                  <span className="text-sm font-bold text-navy-700">School Branding</span>
                  <span className="text-xs text-navy-400 font-semibold">Optional — you can skip this</span>
                </div>

                <div className="flex items-start gap-5">
                  {/* Logo picker with live preview */}
                  <div>
                    <label className="block text-xs font-bold text-navy-500 mb-2">Logo</label>
                    {logoPreview ? (
                      <div className="relative w-20 h-20">
                        <img src={logoPreview} alt="School logo preview"
                          className="w-20 h-20 rounded-2xl object-contain border-2 border-slate-200 bg-white p-1" />
                        <button type="button" onClick={clearLogo} title="Remove logo"
                          className="absolute -top-2 -right-2 w-6 h-6 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600 shadow-pop">
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ) : (
                      <label className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-2xl flex flex-col items-center justify-center cursor-pointer hover:border-royal-400 hover:bg-royal-50 transition-colors">
                        <UploadCloud className="w-5 h-5 text-navy-400" />
                        <span className="text-[10px] text-navy-400 mt-1 font-bold">Upload</span>
                        <input type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
                      </label>
                    )}
                    <p className="text-[10px] text-navy-400 mt-1.5 font-semibold">PNG/JPG, max 2MB</p>
                  </div>

                  {/* Colour presets + free-form picker */}
                  <div className="flex-1 min-w-0">
                    <label className="block text-xs font-bold text-navy-500 mb-2">Main Colour</label>
                    <div className="flex flex-wrap gap-2">
                      {COLOR_PRESETS.map(c => (
                        <button key={c} type="button" onClick={() => setBrandColor(c)}
                          title={c} aria-label={`Use ${c}`}
                          className={`w-8 h-8 rounded-xl transition-all ${brandColor === c ? 'ring-2 ring-offset-2 ring-navy-700' : 'hover:scale-110'}`}
                          style={{ backgroundColor: c }} />
                      ))}
                    </div>
                    {/* The presets are only a starting point, and a bare
                        <input type="color"> is an 8mm square that reads as a
                        twelfth swatch rather than as the door to the full
                        picker. A school whose seal is a specific maroon needs
                        to know it can get there, so the control says what it
                        is instead of relying on the swatch being recognised. */}
                    <label className="flex items-center gap-2 mt-3 cursor-pointer w-fit group">
                      <span className="relative inline-flex shrink-0">
                        <input type="color" value={brandColor || DEFAULT_BRAND}
                          onChange={e => setBrandColor(e.target.value.toUpperCase())}
                          aria-label="Pick any colour with the colour wheel"
                          className="w-9 h-9 rounded-lg cursor-pointer border-2 border-slate-200 bg-white p-0.5" />
                        <Pipette className="w-3.5 h-3.5 absolute -right-1 -bottom-1 p-0.5 rounded-full bg-white text-navy-500 border border-slate-200 pointer-events-none" />
                      </span>
                      <span className="text-xs font-bold text-navy-500 group-hover:text-navy-700 underline decoration-dotted underline-offset-2">
                        Not your colour? Pick any shade
                      </span>
                    </label>
                    {/* Outside the <label>: a button inside it would open the
                        colour picker on its way to clearing the colour. */}
                    <div className="flex items-center gap-2 mt-2">
                      <span className="text-xs font-mono font-bold text-navy-500">{brandColor || 'Default'}</span>
                      {brandColor && (
                        <button type="button" onClick={() => setBrandColor('')}
                          className="text-xs font-bold text-navy-400 hover:text-navy-600 underline">Clear</button>
                      )}
                    </div>
                  </div>
                </div>

                {/* How it will look on the dashboards */}
                {(logoPreview || brandColor) && (
                  <div className="mt-5 p-4 rounded-2xl bg-cream-100 border-2 border-cream-200">
                    <p className="text-[10px] font-extrabold uppercase tracking-wider text-navy-400 mb-2.5">Preview</p>
                    <div className="flex items-center gap-3">
                      <div className="w-12 h-12 rounded-2xl flex items-center justify-center overflow-hidden shrink-0 border-2"
                        style={{
                          backgroundColor: `${brandColor || DEFAULT_BRAND}1A`,
                          borderColor: `${brandColor || DEFAULT_BRAND}33`,
                          color: brandColor || DEFAULT_BRAND,
                        }}>
                        {logoPreview
                          ? <img src={logoPreview} alt="" className="w-full h-full object-contain p-1" />
                          : <ImageIcon className="w-5 h-5" />}
                      </div>
                      <p className="font-display font-extrabold text-navy-700 truncate">
                        {formData.schoolName || 'Your School Name'}
                      </p>
                    </div>
                  </div>
                )}
              </div>

              {error && (
                <div role="alert" className="bg-red-50 border-2 border-red-200 text-red-700 text-sm font-bold rounded-2xl p-3.5 flex items-start gap-2">
                  <span className="shrink-0">⚠️</span>
                  <span>{error}</span>
                </div>
              )}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-full py-4 font-bold text-sm text-white bg-brand-chrome shadow-pop
                           hover:bg-ink-800 active:translate-y-1 active:shadow-none transition-all
                           disabled:opacity-50 disabled:pointer-events-none"
              >
                {isSubmitting ? 'Registering school...' : 'Register School & Create Admin'}
              </button>
            </form>

            <p className="text-center mt-7 pt-6 border-t-2 border-cream-200 text-sm text-navy-500">
              Already have an account?{' '}
              <Link to="/login" className="font-extrabold text-royal-500 hover:text-royal-600">
                Log in here
              </Link>
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
