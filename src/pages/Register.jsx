import { useState, useEffect } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, Eye, EyeOff, UploadCloud, X, Image as ImageIcon } from 'lucide-react';
import { API_URL } from '../config';

/** Suggested school colours — the admin can still pick any hex. */
const COLOR_PRESETS = ['#1E3A8A', '#0F766E', '#B91C1C', '#B45309', '#6D28D9', '#0E7490', '#166534', '#334155'];

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
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="p-8 bg-slate-800 text-white text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">Register Your School</h1>
          <p className="text-white/80">Creates your school and its first admin account</p>
        </div>

        <div className="p-8">
          <div className="bg-blue-50 border border-blue-200 rounded-xl p-4 mb-5 text-xs text-blue-800 leading-relaxed">
            As the school admin you'll create teacher accounts, publish the curriculum for each grade
            level and subject, and set the rubrics your teachers grade with. Teachers and students
            can't sign themselves up — you create teachers, and they create their students.
          </div>
          <form onSubmit={handleRegister} className="space-y-4" autoComplete="off">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Your Full Name</label>
              <input
                type="text"
                required
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all"
                placeholder="Juan Dela Cruz"
                onChange={(e) => setFormData({...formData, name: e.target.value})}
              />
            </div>
            
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Email Address</label>
              <input
                type="email"
                required
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all"
                placeholder="teacher@deped.gov.ph"
                onChange={(e) => setFormData({...formData, email: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">School Name</label>
              <input
                type="text"
                required
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all"
                placeholder="Manila Science High School"
                onChange={(e) => setFormData({...formData, schoolName: e.target.value})}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all pr-12"
                  placeholder="••••••••"
                  onChange={(e) => setFormData({...formData, password: e.target.value})}
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-5 h-5" /> : <Eye className="w-5 h-5" />}
                </button>
              </div>
            </div>
            
            {/* ── Optional branding ── */}
            <div className="pt-2 border-t border-slate-100">
              <div className="flex items-baseline justify-between mb-3">
                <span className="text-sm font-medium text-slate-700">School Branding</span>
                <span className="text-xs text-slate-400">Optional — you can skip this</span>
              </div>

              <div className="flex items-start gap-4">
                {/* Logo picker with live preview */}
                <div>
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Logo</label>
                  {logoPreview ? (
                    <div className="relative w-20 h-20">
                      <img src={logoPreview} alt="School logo preview"
                        className="w-20 h-20 rounded-xl object-contain border border-slate-200 bg-white p-1" />
                      <button type="button" onClick={clearLogo} title="Remove logo"
                        className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-500 text-white rounded-full flex items-center justify-center hover:bg-red-600">
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <label className="w-20 h-20 border-2 border-dashed border-slate-200 rounded-xl flex flex-col items-center justify-center cursor-pointer hover:border-slate-400 hover:bg-slate-50 transition-colors">
                      <UploadCloud className="w-5 h-5 text-slate-400" />
                      <span className="text-[10px] text-slate-400 mt-1">Upload</span>
                      <input type="file" accept="image/*" className="hidden" onChange={handleLogoPick} />
                    </label>
                  )}
                  <p className="text-[10px] text-slate-400 mt-1">PNG/JPG, max 2MB</p>
                </div>

                {/* Colour presets + free-form picker */}
                <div className="flex-1 min-w-0">
                  <label className="block text-xs font-medium text-slate-500 mb-1.5">Main Colour</label>
                  <div className="flex flex-wrap gap-1.5">
                    {COLOR_PRESETS.map(c => (
                      <button key={c} type="button" onClick={() => setBrandColor(c)}
                        title={c} aria-label={`Use ${c}`}
                        className={`w-7 h-7 rounded-lg transition-all ${brandColor === c ? 'ring-2 ring-offset-2 ring-slate-800' : 'hover:scale-110'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                  <div className="flex items-center gap-2 mt-2.5">
                    <input type="color" value={brandColor || '#1E3A8A'}
                      onChange={e => setBrandColor(e.target.value.toUpperCase())}
                      className="w-8 h-8 rounded cursor-pointer border border-slate-200 bg-white p-0.5" />
                    <span className="text-xs font-mono text-slate-500">{brandColor || 'Default'}</span>
                    {brandColor && (
                      <button type="button" onClick={() => setBrandColor('')}
                        className="text-xs text-slate-400 hover:text-slate-600 underline">Clear</button>
                    )}
                  </div>
                </div>
              </div>

              {/* How it will look on the dashboards */}
              {(logoPreview || brandColor) && (
                <div className="mt-4 p-3 rounded-xl bg-slate-50 border border-slate-200">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">Preview</p>
                  <div className="flex items-center gap-3">
                    <div className="w-11 h-11 rounded-xl flex items-center justify-center overflow-hidden shrink-0 border"
                      style={brandColor
                        ? { backgroundColor: `${brandColor}1A`, borderColor: `${brandColor}33`, color: brandColor }
                        : { backgroundColor: '#EFF6FF', borderColor: '#DBEAFE', color: '#1E3A8A' }}>
                      {logoPreview
                        ? <img src={logoPreview} alt="" className="w-full h-full object-contain p-1" />
                        : <ImageIcon className="w-5 h-5" />}
                    </div>
                    <p className="font-bold text-brand-slate truncate">
                      {formData.schoolName || 'Your School Name'}
                    </p>
                  </div>
                </div>
              )}
            </div>

            {error && (
              <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3 flex items-start gap-2">
                <span className="shrink-0">⚠️</span>
                <span>{error}</span>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full py-3 mt-4 rounded-lg text-white font-medium bg-slate-800 hover:bg-slate-900 transition-all shadow-md disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isSubmitting ? 'Registering school...' : 'Register School & Create Admin'}
            </button>
          </form>

          <p className="text-center mt-6 text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/" className="text-slate-800 font-semibold hover:underline">
              Log in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
