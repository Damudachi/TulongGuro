import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, UserCircle, GraduationCap, Eye, EyeOff, Building2 } from 'lucide-react';
import { API_URL } from '../config';

const ROLES = {
  teacher: { label: 'Teacher', icon: UserCircle, accent: 'text-brand-navy', header: 'bg-brand-navy', button: 'bg-brand-navy hover:bg-blue-900', idLabel: 'Email Address', idPlaceholder: 'teacher@deped.gov.ph', idType: 'email', home: '/teacher/dashboard' },
  student: { label: 'Student', icon: GraduationCap, accent: 'text-brand-green', header: 'bg-brand-green', button: 'bg-brand-green hover:bg-emerald-600', idLabel: 'Student ID', idPlaceholder: 'Enter your ID (e.g. RIZAL-001)', idType: 'text', home: '/student/dashboard' },
  admin: { label: 'Admin', icon: Building2, accent: 'text-slate-700', header: 'bg-slate-800', button: 'bg-slate-800 hover:bg-slate-900', idLabel: 'Email Address', idPlaceholder: 'admin@school.edu.ph', idType: 'email', home: '/admin/teachers' },
};

export default function Login() {
  const [role, setRole] = useState('teacher'); // 'teacher' | 'student' | 'admin'
  const navigate = useNavigate();

  const [identifier, setIdentifier] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async (e) => {
    e.preventDefault();
    setErrorMsg('');
    try {
      const response = await fetch(`${API_URL}/api/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: identifier, password, role: role.toUpperCase() })
      });
      const data = await response.json();
      
      if (data.success) {
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate(ROLES[role].home);
      } else {
        setErrorMsg('Invalid credentials. Please check your details and try again.');
      }
    } catch (err) {
      setErrorMsg('Cannot connect to server.');
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className={`p-8 text-white text-center transition-colors duration-300 ${ROLES[role].header}`}>
          <BookOpen className="w-12 h-12 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">TulongGuro</h1>
          <p className="text-white/80">AI-Assisted Grading for Philippine Schools</p>
        </div>

        <div className="p-8">
          <div className="flex bg-slate-100 p-1 rounded-lg mb-8">
            {Object.entries(ROLES).map(([key, cfg]) => (
              <button
                key={key}
                onClick={() => setRole(key)}
                className={`flex-1 flex items-center justify-center py-2 px-2 rounded-md text-sm font-medium transition-all ${
                  role === key ? `bg-white shadow ${cfg.accent}` : 'text-slate-500 hover:text-slate-700'
                }`}
              >
                <cfg.icon className="w-4 h-4 mr-1.5" />
                {cfg.label}
              </button>
            ))}
          </div>

          {/* autoComplete="off" throughout: shared classroom devices should not
              offer the previous user's credentials to the next one. */}
          <form onSubmit={handleLogin} className="space-y-6" autoComplete="off">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {ROLES[role].idLabel}
              </label>
              <input
                type={ROLES[role].idType}
                required
                name="tg-identifier"
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all"
                placeholder={ROLES[role].idPlaceholder}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? "text" : "password"}
                  required
                  name="tg-password"
                  autoComplete="new-password"
                  className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all pr-12"
                  placeholder="••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
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
            
            <button
              type="submit"
              className={`w-full py-3 rounded-lg text-white font-medium transition-all ${ROLES[role].button}`}
            >
              Log In as {ROLES[role].label}
            </button>
            {errorMsg && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg text-center font-medium">
                {errorMsg}
              </div>
            )}
          </form>

          {/* Teacher and student accounts are created for you — only a school
              registers itself, which creates its first admin. */}
          {role === 'admin' ? (
            <p className="text-center mt-6 text-sm text-slate-600">
              School not registered yet?{' '}
              <Link to="/register" className="text-slate-800 font-semibold hover:underline">
                Register your school
              </Link>
            </p>
          ) : (
            <p className="text-center mt-6 text-xs text-slate-400 leading-relaxed">
              {role === 'teacher'
                ? 'Teacher accounts are created by your school admin. Ask them for your login details.'
                : 'Student accounts are created by your teacher. Ask them for your Student ID.'}
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
