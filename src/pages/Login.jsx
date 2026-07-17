import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen, UserCircle, GraduationCap, Eye, EyeOff } from 'lucide-react';
import { API_URL } from '../config';

export default function Login() {
  const [role, setRole] = useState('teacher'); // 'teacher' | 'student'
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
        if (role === 'teacher') {
          navigate('/teacher/dashboard');
        } else {
          navigate('/student/dashboard');
        }
      } else {
        setErrorMsg('Invalid credentials. Did you run the seed script?');
      }
    } catch (err) {
      setErrorMsg('Cannot connect to server.');
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className={`p-8 text-white text-center transition-colors duration-300 ${role === 'teacher' ? 'bg-brand-navy' : 'bg-brand-green'}`}>
          <BookOpen className="w-12 h-12 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">TulongGuro</h1>
          <p className="text-white/80">AI-Assisted Grading for Philippine Schools</p>
        </div>

        <div className="p-8">
          <div className="flex bg-slate-100 p-1 rounded-lg mb-8">
            <button
              onClick={() => setRole('teacher')}
              className={`flex-1 flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium transition-all ${
                role === 'teacher' ? 'bg-white shadow text-brand-navy' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <UserCircle className="w-4 h-4 mr-2" />
              Teacher
            </button>
            <button
              onClick={() => setRole('student')}
              className={`flex-1 flex items-center justify-center py-2 px-4 rounded-md text-sm font-medium transition-all ${
                role === 'student' ? 'bg-white shadow text-brand-green' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              <GraduationCap className="w-4 h-4 mr-2" />
              Student
            </button>
          </div>

          <form onSubmit={handleLogin} className="space-y-6">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-2">
                {role === 'teacher' ? 'Email Address' : 'Student ID'}
              </label>
              <input
                type={role === 'teacher' ? 'email' : 'text'}
                required
                className="w-full px-4 py-3 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all"
                placeholder={role === 'teacher' ? 'teacher@deped.gov.ph' : 'Enter your ID (e.g. RIZAL-001)'}
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
              className={`w-full py-3 rounded-lg text-white font-medium transition-all ${
                role === 'teacher' ? 'bg-brand-navy hover:bg-blue-900' : 'bg-brand-green hover:bg-emerald-600'
              }`}
            >
              Log In as {role === 'teacher' ? 'Teacher' : 'Student'}
            </button>
            {errorMsg && (
              <div className="mt-4 p-3 bg-red-50 border border-red-200 text-red-600 text-sm rounded-lg text-center font-medium">
                {errorMsg}
              </div>
            )}
          </form>

          {role === 'teacher' && (
            <p className="text-center mt-6 text-sm text-slate-600">
              Don't have a teacher account?{' '}
              <Link to="/register" className="text-brand-navy font-semibold hover:underline">
                Sign up here
              </Link>
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
