import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, UploadCloud, X, Image as ImageIcon, ArrowLeft, Clock, Pipette,
  CheckCircle2, AlertTriangle, Loader2, FileText, ShieldCheck } from 'lucide-react';
import { API_URL, apiFetch } from '../config';
import { accountDomain, localPartOf, buildAccountEmail } from '../constants/accountEmails';

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

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * ── How a person's name is written here ──
 *
 * "Lastname, First Name MI" — the form every DepEd record uses, so the admin
 * this creates is filed the same way as the paperwork it will sit beside.
 *
 * Characters are filtered as they are typed rather than complained about
 * afterwards: a digit in a name is always a mistake, and refusing the keystroke
 * says so at the moment it happens instead of at the bottom of a long form.
 *
 * What survives the filter is deliberately wider than A-Z. Philippine names
 * carry ñ (Santo Niño), hyphens (Dela Cruz-Reyes), apostrophes (D'Souza) and
 * full stops (Jr., A.) — and the comma the format itself depends on. Stripping
 * those in the name of "no special characters" would misspell real people,
 * which is a worse failure than the one being prevented.
 */
const NAME_DISALLOWED = /[^A-Za-zÀ-ÖØ-öø-ÿÑñ ,.'-]/g;

const sanitizeName = (value) =>
  value.replace(NAME_DISALLOWED, '').replace(/\s{2,}/g, ' ').replace(/,{2,}/g, ',');

/**
 * What is wrong with this name, or null if nothing is. Returns the sentence to
 * show rather than a boolean, so the field can say which half is missing
 * instead of "invalid".
 */
function fullNameProblem(value) {
  const v = (value || '').trim().replace(/\s+/g, ' ');
  if (!v) return 'Please enter your full name.';
  const parts = v.split(',');
  if (parts.length < 2) return 'Add a comma after your last name — for example "Dela Cruz, Juan A."';
  if (parts.length > 2) return 'Use one comma only — "Lastname, First Name MI".';
  const [last, given] = parts.map(s => s.trim());
  if (last.length < 2) return 'Please write your last name before the comma.';
  if (given.length < 2) return 'Please write your first name after the comma.';
  // A name made only of punctuation passes every check above.
  if (!/[A-Za-zÀ-ÖØ-öø-ÿÑñ]{2}/.test(last) || !/[A-Za-zÀ-ÖØ-öø-ÿÑñ]{2}/.test(given)) {
    return 'Please write your name in letters.';
  }
  return null;
}

/**
 * A permission the registrant grants before the thing it permits can happen.
 *
 * Both uses gate an upload behind it, and the gating is the point: a tick box
 * sitting next to an already-filled file field is a formality, because the file
 * is handed over either way. Asked first, and with the control it unlocks
 * visibly inert until it is ticked, the answer is a decision rather than a
 * rubber stamp.
 *
 * The label says what will happen to the file, not "I agree to the terms" —
 * consent to something unread is not consent.
 */
function ConsentCheck({ checked, onChange, children }) {
  return (
    <label className="flex items-start gap-2.5 cursor-pointer group mb-3">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5 w-4 h-4 shrink-0 rounded border-2 border-navy-300 text-royal-500
                   focus:ring-2 focus:ring-royal-400 focus:ring-offset-0 cursor-pointer accent-royal-500"
      />
      <span className="text-xs text-navy-600 font-semibold leading-relaxed group-hover:text-navy-700">
        {children}
      </span>
    </label>
  );
}

export default function Register() {
  // `email` holds only the part before the @. The domain is fixed and rendered
  // as a suffix on the field rather than left to be typed: an admin account has
  // to sit on this school's @admin.<code>.edu.ph, and a form that accepts
  // anything and refuses it on submit teaches the rule one rejection at a time.
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    schoolName: '',
    // A mailbox that actually receives mail, unlike the login above it — that
    // one sits on a synthetic domain with nothing behind it. This is the only
    // address on the record anyone can reach the school on.
    contactEmail: '',
  });
  // ── The school's code ──
  //
  // The short string that separates this school's accounts from every other
  // school's: it becomes the middle label of every staff login domain
  // (principal@admin.mes-maba.edu.ph) and the prefix of every student ID
  // (MES-MABA-26-0001). See server/schoolSlug.js.
  //
  // Settled here, on the form, rather than assigned silently afterwards. The
  // code is in every login the school will ever type, so the one moment they
  // are certain to be paying attention is the moment to show it to them — and
  // if the obvious code is already held by another school, this is where they
  // choose a different one, with alternatives offered, instead of finding out
  // from a teacher-creation form that will not accept the address they expect.
  //
  //   value       what will be sent, '' until the first check answers
  //   state       'idle' | 'checking' | 'available' | 'taken' | 'invalid'
  //   edited      whether the registrant has typed over the suggestion; once
  //               true the school name no longer re-suggests, or their choice
  //               would be overwritten by a lookup filling the name field in
  //   preview     the three example logins, built by the server so the client
  //               cannot disagree with what will actually be created
  const [schoolCode, setSchoolCode] = useState({
    value: '', state: 'idle', error: null, suggestions: [], preview: null, edited: false,
  });
  const adminEmail = buildAccountEmail(formData.email, 'ADMIN', schoolCode.value);

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
  // The registrant's own school/employee ID. Required on every registration:
  // the School ID above proves the school exists, and this is the only thing on
  // the form suggesting the person filling it in belongs to that school.
  const [registrantId, setRegistrantId] = useState(null);
  const [registrantIdPreview, setRegistrantIdPreview] = useState(null);
  // Consent, asked before the upload rather than alongside it — see ConsentCheck.
  const [idConsent, setIdConsent] = useState(false);
  const [logoConsent, setLogoConsent] = useState(false);
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
  // Whether the school name currently in the form came from the DepEd lookup
  // rather than from typing. Drives the "filled from DepEd records" note, and
  // is cleared the moment the registrant edits it themselves.
  const [nameFromLookup, setNameFromLookup] = useState(false);
  // The name field's own complaint, shown under it rather than in the form-wide
  // error banner at the bottom — it belongs next to the field it is about.
  const [nameError, setNameError] = useState(null);

  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);
  useEffect(() => () => { if (registrantIdPreview) URL.revokeObjectURL(registrantIdPreview); },
    [registrantIdPreview]);

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
        else if (data.verdict === 'FOUND') {
          setLookup({ state: data.alreadyRegistered ? 'taken' : 'found', school: data.school });
          // Filled in rather than offered. The masterlist's spelling is the one
          // an operator compares against, so anything the registrant typed by
          // hand is at best the same and at worst a mismatch they would have to
          // be asked about. The field stays editable — a school whose DepEd
          // record is out of date has to be able to say so.
          setFormData(prev => ({ ...prev, schoolName: data.school.name }));
          setNameFromLookup(true);
        } else setLookup({ state: 'missing' });
      } catch {
        // A lookup that could not run must not read as "your school isn't
        // real" — the server checks again on submit, so silence is correct.
        if (!cancelled) setLookup(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [schoolId]);

  /**
   * Ask the server what code this school gets, and whether it is free.
   *
   * Debounced the same way the School ID lookup is, and for the same reasons:
   * one request per pause rather than one per keystroke, and a `cancelled` flag
   * so a slow earlier answer cannot land on top of a later one and report the
   * wrong verdict about the wrong code.
   *
   * Runs on the school name until the registrant edits the code themselves.
   * After that the name no longer drives it — the DepEd lookup fills the name
   * field in on its own, and having that overwrite a code somebody had
   * deliberately chosen would undo their choice without telling them.
   */
  useEffect(() => {
    const name = formData.schoolName.trim();
    const typed = schoolCode.edited ? schoolCode.value : '';
    let cancelled = false;
    const timer = setTimeout(async () => {
      if (cancelled) return;
      // Emptying both fields clears the verdict, for the same reason clearing
      // the School ID clears its own: a stale "✓ available" sitting under an
      // empty box is worse than no answer. Done inside the debounce rather than
      // in the effect body — a synchronous setState there cascades renders, and
      // the delay is invisible against a field the registrant just emptied.
      if (!name && !typed) {
        setSchoolCode(prev => ({ ...prev, state: 'idle', error: null, suggestions: [], preview: null }));
        return;
      }
      setSchoolCode(prev => ({ ...prev, state: 'checking' }));
      try {
        const query = new URLSearchParams({ schoolName: name, code: typed });
        const res = await apiFetch(`${API_URL}/api/auth/school-code?${query}`);
        const data = await res.json();
        // A superseded request returns silently — a newer one is already in
        // flight and owns the state. A *failed* one must not: these two shared
        // a `return` at first, which left the spinner turning forever every
        // time the check could not run. Nothing on the form said why, and the
        // field looked broken rather than unanswered.
        if (cancelled) return;
        if (!data.success) {
          setSchoolCode(prev => ({ ...prev, state: 'idle', error: null, suggestions: [], preview: null }));
          return;
        }
        setSchoolCode(prev => ({
          ...prev,
          // The suggestion is adopted only while the registrant has not typed
          // their own — otherwise the box would rewrite itself under them.
          value: prev.edited ? prev.value : (data.code || ''),
          state: data.available === false ? (data.error ? 'taken' : 'invalid') : 'available',
          error: data.error || null,
          suggestions: data.suggestions || [],
          preview: data.preview || null,
        }));
      } catch {
        // A check that could not run must not read as "this code is taken".
        // Registration still completes: sending no code makes the server derive
        // one, so a registrant whose check never answered is not stuck — see
        // the schoolSlug handling in /api/auth/register.
        if (!cancelled) {
          setSchoolCode(prev => ({ ...prev, state: 'idle', error: null, suggestions: [], preview: null }));
        }
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [formData.schoolName, schoolCode.value, schoolCode.edited]);

  /** The registrant typing their own code. Marks it edited, which stops the
   *  school name from suggesting over the top of it from here on. */
  const handleSchoolCodeChange = (value) => {
    const cleaned = String(value).toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 24);
    setSchoolCode(prev => ({ ...prev, value: cleaned, edited: true, state: 'checking' }));
  };

  // Clearing the field has to clear its verdict too, or a stale "✓ matched"
  // sits under an empty box.
  const handleSchoolIdChange = (value) => {
    const digits = value.replace(/\D/g, '').slice(0, 9);
    setSchoolId(digits);
    if (digits.length < 5) setLookup(null);
    setProofRequired(false);
    // The name stays — deleting what someone can see would be startling — but
    // it is no longer attributable to DepEd until a new lookup says so, and a
    // note claiming otherwise over a stale name is the wrong kind of wrong.
    setNameFromLookup(false);
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

  /** Mirrors the server's own rules so a too-large photo is caught before it is
   *  uploaded over a phone connection rather than after. */
  const handleRegistrantIdPick = (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    const isPdf = file.type === 'application/pdf';
    if (!file.type.startsWith('image/') && !isPdf) {
      return setError('Your ID must be a photo or a PDF.');
    }
    if (file.size > 8 * 1024 * 1024) return setError('The ID photo must be under 8MB.');
    setError('');
    if (registrantIdPreview) URL.revokeObjectURL(registrantIdPreview);
    // A PDF has nothing to show inline, so it falls back to the filename row.
    setRegistrantIdPreview(isPdf ? null : URL.createObjectURL(file));
    setRegistrantId(file);
  };

  const clearRegistrantId = () => {
    if (registrantIdPreview) URL.revokeObjectURL(registrantIdPreview);
    setRegistrantIdPreview(null);
    setRegistrantId(null);
  };

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
    // Checked here as well as on the server: these sit far enough down a long
    // form that "you missed one" is worth saying without a round trip. Ordered
    // the way the form reads, so the message points at the first gap rather
    // than the last.
    // Runs before the consent checks so the form is corrected top to bottom,
    // and marks the field itself rather than only the banner — otherwise the
    // message names a problem the reader has to go hunting for.
    const nameProblem = fullNameProblem(formData.name);
    if (nameProblem) {
      setNameError(nameProblem);
      return setError(nameProblem);
    }
    if (!idConsent) {
      return setError('Please tick the box agreeing to upload your ID, then attach it.');
    }
    if (!registrantId) {
      return setError('Please attach a photo of your school or employee ID before submitting.');
    }
    if (!logoConsent) {
      return setError('Please tick the box allowing us to display your school logo, then upload it.');
    }
    if (!logo) {
      return setError('Please upload your school logo.');
    }
    setError('');
    setIsSubmitting(true);
    try {
      const body = new FormData();
      // The full address, not the local part the field holds.
      Object.entries({ ...formData, email: adminEmail }).forEach(([k, v]) => body.append(k, v));
      body.append('depedSchoolId', schoolId);
      // The code the registrant settled on, sent explicitly rather than left to
      // the server to derive. They have been shown the logins it produces and
      // have typed an admin address to match, so the server honours this or
      // refuses it — it never quietly substitutes a different one.
      if (schoolCode.value) body.append('schoolSlug', schoolCode.value);
      if (brandColor) body.append('brandColor', brandColor);
      if (logo) body.append('logo', logo);
      if (proof) body.append('proof', proof);
      body.append('registrantId', registrantId);
      // Sent so the server records *that* permission was given, not merely that
      // a file arrived. A consent nobody can produce afterwards is not one.
      body.append('idConsent', String(idConsent));
      body.append('logoConsent', String(logoConsent));

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
                  placeholder="Dela Cruz, Juan A."
                  aria-describedby="full-name-hint"
                  // Controlled, which it was not before — without `value` the
                  // filtered string never made it back to the field, so a typed
                  // digit would have stayed on screen.
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: sanitizeName(e.target.value) })}
                  // Checked on blur, not per keystroke: "Dela" is an incomplete
                  // name, not a wrong one, and saying so while someone is still
                  // typing it is nagging rather than helping.
                  onBlur={() => setNameError(fullNameProblem(formData.name))}
                />
                {nameError ? (
                  <p className="flex items-start gap-1.5 text-xs font-semibold text-red-600 mt-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" /> {nameError}
                  </p>
                ) : (
                  <p id="full-name-hint" className="text-xs text-navy-400 mt-1.5 font-semibold">
                    Lastname, First Name MI — as it appears on your DepEd records.
                  </p>
                )}
              </div>

              {/* ── School name, then code, then the admin's address ──
                  This order is load-bearing, not cosmetic. The code is derived
                  from the name, and the admin's address is built on the code
                  (principal@admin.mes-maba.edu.ph), so asking for the address
                  first — as this form used to — showed a domain that changed
                  under the registrant as soon as they typed their school name.
                  Each field now depends only on the ones above it. */}
              <div>
                <label className="tg-label">School Name</label>
                <input
                  type="text"
                  required
                  className="tg-input"
                  placeholder="Manila Science High School"
                  value={formData.schoolName}
                  onChange={(e) => {
                    setFormData({ ...formData, schoolName: e.target.value });
                    setNameFromLookup(false);
                  }}
                />
                {/* Says where the value came from, because a field that fills
                    itself is otherwise indistinguishable from one the browser
                    autocompleted — and this one is the name an operator will
                    check against DepEd's records. */}
                {nameFromLookup && (
                  <p className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700 mt-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
                    Filled from DepEd records — edit it if your school's name has changed.
                  </p>
                )}
              </div>

              {/* ── School code ──
                  Suggested from the name, editable, checked live. The preview
                  below it is the part that actually teaches the rule: a
                  registrant reading "principal@admin.mes-maba.edu.ph" grasps
                  what the code is for instantly, where "initials plus the first
                  four letters of the first word" has to be decoded first. */}
              <div>
                <label className="tg-label" htmlFor="school-code">School Code</label>
                <div className="flex items-stretch rounded-2xl border-2 border-navy-700/10 bg-white overflow-hidden focus-within:border-royal-400 transition-colors">
                  <input
                    id="school-code"
                    type="text"
                    className="flex-1 min-w-0 px-4 py-3 outline-none text-navy-700 font-semibold font-mono lowercase"
                    placeholder="mes-maba"
                    autoComplete="off"
                    spellCheck="false"
                    aria-describedby="school-code-hint"
                    value={schoolCode.value}
                    onChange={(e) => handleSchoolCodeChange(e.target.value)}
                  />
                  <span className="shrink-0 px-3 grid place-items-center bg-cream-100 border-l-2 border-navy-700/10">
                    {schoolCode.state === 'checking' && <Loader2 className="w-4 h-4 animate-spin text-navy-400" />}
                    {schoolCode.state === 'available' && <CheckCircle2 className="w-4 h-4 text-emerald-600" />}
                    {(schoolCode.state === 'taken' || schoolCode.state === 'invalid')
                      && <AlertTriangle className="w-4 h-4 text-amber-600" />}
                  </span>
                </div>

                {schoolCode.error && (
                  <p className="flex items-start gap-1.5 text-xs font-semibold text-amber-700 mt-1.5">
                    <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                    {/* Never names the school that holds it. This form is open
                        to anyone, so anything it reveals about who is on the
                        platform is revealed to everyone. */}
                    {schoolCode.error}
                  </p>
                )}

                {schoolCode.suggestions.length > 0 && (
                  <div className="flex flex-wrap items-center gap-2 mt-2">
                    <span className="text-xs font-semibold text-navy-400">Try:</span>
                    {schoolCode.suggestions.map((option) => (
                      <button
                        key={option}
                        type="button"
                        onClick={() => handleSchoolCodeChange(option)}
                        className="px-2.5 py-1 rounded-lg bg-royal-50 border border-royal-200 text-xs
                                   font-mono font-bold text-royal-700 hover:bg-royal-100 transition-colors"
                      >
                        {option}
                      </button>
                    ))}
                  </div>
                )}

                {schoolCode.state === 'available' && schoolCode.preview && (
                  <div className="mt-2.5 rounded-xl bg-cream-100 border border-navy-700/10 p-3">
                    <p className="text-xs font-extrabold text-navy-500 mb-1.5">
                      Your school's sign-ins will look like this:
                    </p>
                    <ul className="space-y-1 text-xs font-mono text-navy-600 break-all">
                      <li><span className="font-sans font-bold text-navy-400 mr-1.5">Admin</span>{schoolCode.preview.admin}</li>
                      <li><span className="font-sans font-bold text-navy-400 mr-1.5">Teacher</span>{schoolCode.preview.teacher}</li>
                      <li><span className="font-sans font-bold text-navy-400 mr-1.5">Student</span>{schoolCode.preview.student}</li>
                    </ul>
                  </div>
                )}

                <p id="school-code-hint" className="text-xs text-navy-400 mt-1.5 font-semibold">
                  Suggested from your school's name — the initials plus the first four letters of the
                  first word. You can change it now; once your school is approved it is permanent.
                </p>
              </div>

              <div>
                <label className="tg-label">Admin Email Address</label>
                {/* Split field: they type the name, the domain is shown and
                    cannot be changed. localPartOf() cuts at any @ they type or
                    paste, so pasting a whole address does the obvious thing
                    instead of doubling the domain. The suffix is allowed to
                    truncate — it carries the school code now and no longer fits
                    beside the box on a phone. */}
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
                  <span
                    title={`@${accountDomain('ADMIN', schoolCode.value)}`}
                    className="shrink min-w-0 truncate px-3 grid place-items-center bg-cream-100 border-l-2 border-navy-700/10 text-sm font-extrabold text-navy-500 select-none"
                  >
                    @{accountDomain('ADMIN', schoolCode.value)}
                  </span>
                </div>
                <p id="admin-email-hint" className="text-xs text-navy-400 mt-1.5 font-semibold break-words">
                  Your account will sign in as {adminEmail || `principal@${accountDomain('ADMIN', schoolCode.value)}`}.
                  Teachers you create later get @{accountDomain('TEACHER', schoolCode.value)} addresses.
                </p>
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
                  /* No placeholder. It used to show 136353, which is a real
                     school's ID (Tanulong Elementary School) — a live value
                     sitting in the one field on this form that is supposed to
                     be proof, greyed out and one autofill away from being
                     submitted as someone's answer. The hint below says what
                     belongs here without naming anybody's school. */
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
                      {/* Now a way back rather than a way in: the name is
                          filled automatically on a match, so this only appears
                          once the registrant has edited it away from DepEd's
                          spelling, and its job is to undo that in one tap. */}
                      {formData.schoolName.trim() !== lookup.school.name && (
                        <button type="button"
                          onClick={() => {
                            setFormData({ ...formData, schoolName: lookup.school.name });
                            setNameFromLookup(true);
                          }}
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

              {/* ── The registrant's own ID ──
                  Always shown, unlike the permit above. The School ID field
                  proves the school is real; DepEd publishes that list, so it
                  says nothing about whether this person works there. This is
                  the half that does, which is why it is not conditional on the
                  lookup coming back clean — a matched school is exactly what
                  an impersonator would type. */}
              <div className="p-4 rounded-2xl bg-cream-100 border-2 border-navy-700/10">
                <label className="tg-label flex items-center gap-1.5">
                  <ShieldCheck className="w-4 h-4 text-royal-500" />
                  Your school or employee ID
                </label>
                <p className="text-xs text-navy-500 font-semibold mb-3 leading-relaxed">
                  A photo of your own school ID, employee ID, or a certification of employment —
                  so we can check you work at the school you're registering.
                </p>

                <ConsentCheck checked={idConsent} onChange={(v) => {
                  setIdConsent(v);
                  // Withdrawing consent has to take the file with it, or the
                  // upload outlives the permission that allowed it.
                  if (!v) clearRegistrantId();
                }}>
                  I agree to upload a photo of my ID so TulongGuro can verify I work at this school.
                </ConsentCheck>

                {registrantId ? (
                  <div className="flex items-center gap-3 p-3 rounded-xl bg-white border-2 border-navy-700/10">
                    {registrantIdPreview ? (
                      <img src={registrantIdPreview} alt="ID preview"
                        className="w-14 h-10 object-cover rounded-lg border border-navy-700/10 shrink-0" />
                    ) : (
                      <FileText className="w-4 h-4 text-navy-500 shrink-0" />
                    )}
                    <span className="text-xs font-bold text-navy-700 truncate flex-1 min-w-0">
                      {registrantId.name}
                    </span>
                    <button type="button" onClick={clearRegistrantId} title="Remove ID"
                      className="shrink-0 text-navy-400 hover:text-red-600">
                      <X className="w-4 h-4" />
                    </button>
                  </div>
                ) : (
                  /* Inert until consent is given — `cursor-not-allowed` and the
                     muted palette say so before it is clicked, and the disabled
                     input means clicking it does nothing rather than opening a
                     picker whose result would be refused. */
                  <label className={cn(
                    'flex items-center justify-center gap-2 p-4 border-2 border-dashed rounded-xl transition-colors',
                    idConsent
                      ? 'border-navy-300 cursor-pointer hover:border-royal-400 hover:bg-royal-50'
                      : 'border-navy-200 bg-navy-50/40 cursor-not-allowed',
                  )}>
                    <UploadCloud className={cn('w-4 h-4', idConsent ? 'text-navy-400' : 'text-navy-300')} />
                    <span className={cn('text-xs font-bold', idConsent ? 'text-navy-500' : 'text-navy-300')}>
                      {idConsent ? 'Attach your ID' : 'Tick the box above first'}
                    </span>
                    {/* `capture` is a hint, not a restriction — on a phone it
                        opens the camera, on a laptop it is ignored and the
                        normal file picker appears. */}
                    <input type="file" accept="image/*,.pdf" capture="environment"
                      disabled={!idConsent}
                      className="hidden" onChange={handleRegistrantIdPick} />
                  </label>
                )}

                {/* Said plainly and next to the upload, because this is the one
                    field on the form that asks for a photograph of a person.
                    Someone handing over an ID is owed the reason and the
                    limits at the moment they do it, not in a policy page. */}
                <p className="text-[10px] text-navy-400 mt-2 font-semibold leading-relaxed">
                  Photo or PDF — max 8MB. Stored privately, visible only to the TulongGuro reviewer
                  approving your school, and never shown to other schools or published anywhere.
                </p>
              </div>

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
                  @{accountDomain('ADMIN', schoolCode.value)} sign-in above, which is a username rather than a mailbox.
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

              {/* ── Branding ──
                  The logo is required; the colour is not. They are shown
                  together because they are the same decision to a school, but
                  only one of them is a file we would be storing and displaying
                  on their behalf, and only that one needs permission. */}
              <div className="pt-5 border-t-2 border-cream-200">
                <div className="flex items-baseline justify-between mb-4">
                  <span className="text-sm font-bold text-navy-700">School Branding</span>
                  <span className="text-xs text-navy-400 font-semibold">Logo required · colour optional</span>
                </div>

                <ConsentCheck checked={logoConsent} onChange={(v) => {
                  setLogoConsent(v);
                  if (!v) clearLogo();
                }}>
                  I allow TulongGuro to display our school logo across our school's pages —
                  dashboards, report cards and printed records.
                </ConsentCheck>

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
                      <label className={cn(
                        'w-20 h-20 border-2 border-dashed rounded-2xl flex flex-col items-center justify-center transition-colors',
                        logoConsent
                          ? 'border-slate-300 cursor-pointer hover:border-royal-400 hover:bg-royal-50'
                          : 'border-slate-200 bg-navy-50/40 cursor-not-allowed',
                      )}>
                        <UploadCloud className={cn('w-5 h-5', logoConsent ? 'text-navy-400' : 'text-navy-300')} />
                        <span className={cn('text-[10px] mt-1 font-bold text-center leading-tight px-1',
                          logoConsent ? 'text-navy-400' : 'text-navy-300')}>
                          {logoConsent ? 'Upload' : 'Tick above'}
                        </span>
                        <input type="file" accept="image/*" disabled={!logoConsent}
                          className="hidden" onChange={handleLogoPick} />
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
