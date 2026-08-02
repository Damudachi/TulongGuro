import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, UploadCloud, X, Image as ImageIcon, ArrowLeft } from 'lucide-react';
import { API_URL } from '../config';

/** Suggested school colours — the admin can still pick any hex. */
const COLOR_PRESETS = ['#2B59C3', '#0A2463', '#2A9D9A', '#EE2F80', '#8E5CAF', '#C9A417', '#7E9410', '#4A9BC9'];

/** Fallback swatch when the school picks no colour of its own. */
const DEFAULT_BRAND = '#2B59C3';

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    schoolName: ''
  });
  // Branding is optional — a school with neither falls back to the initials
  // placeholder and the default palette.
  const [logo, setLogo] = useState(null);
  const [logoPreview, setLogoPreview] = useState(null);
  const [brandColor, setBrandColor] = useState('');
  const [error, setError] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showPassword, setShowPassword] = useState(false);

  useEffect(() => () => { if (logoPreview) URL.revokeObjectURL(logoPreview); }, [logoPreview]);

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
      Object.entries(formData).forEach(([k, v]) => body.append(k, v));
      if (brandColor) body.append('brandColor', brandColor);
      if (logo) body.append('logo', logo);

      const response = await fetch(`${API_URL}/api/auth/register`, { method: 'POST', body });
      const data = await response.json();
      if(data.success) {
        localStorage.setItem('user', JSON.stringify({ ...data.user, school: data.school }));
        navigate('/admin/teachers');
      } else {
        setError(data.error || 'Registration failed. Please try again.');
      }
    } catch (e) {
      setError('Network Error. Please check your connection.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-cream-100 tg-dotgrid flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-lg">
        <Link to="/" className="inline-flex items-center gap-1.5 text-sm font-bold text-navy-500 hover:text-royal-500 mb-4">
          <ArrowLeft className="w-4 h-4" /> Back to home
        </Link>

        <div className="bg-white rounded-[2rem] shadow-card-lg overflow-hidden border-2 border-navy-700/5">
          {/* ── Header ── */}
          <div className="relative bg-navy-700 px-8 py-10 text-white text-center overflow-hidden">
            <div className="absolute -top-12 -right-10 w-44 h-44 rounded-full bg-royal-500/30" aria-hidden="true" />
            <div className="absolute -bottom-16 -left-12 w-52 h-52 rounded-full bg-aqua-400/15" aria-hidden="true" />
            <div className="relative">
              <span className="w-14 h-14 rounded-3xl bg-white/15 grid place-items-center mx-auto mb-4">
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
                <label className="tg-label">Email Address</label>
                <input
                  type="email"
                  required
                  className="tg-input"
                  placeholder="teacher@deped.gov.ph"
                  onChange={(e) => setFormData({...formData, email: e.target.value})}
                />
              </div>

              <div>
                <label className="tg-label">School Name</label>
                <input
                  type="text"
                  required
                  className="tg-input"
                  placeholder="Manila Science High School"
                  onChange={(e) => setFormData({...formData, schoolName: e.target.value})}
                />
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
                    <div className="flex items-center gap-2 mt-3">
                      <input type="color" value={brandColor || DEFAULT_BRAND}
                        onChange={e => setBrandColor(e.target.value.toUpperCase())}
                        className="w-9 h-9 rounded-lg cursor-pointer border-2 border-slate-200 bg-white p-0.5" />
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
                className="w-full rounded-full py-4 font-bold text-sm text-white bg-navy-700 shadow-pop
                           hover:bg-navy-800 active:translate-y-1 active:shadow-none transition-all
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
