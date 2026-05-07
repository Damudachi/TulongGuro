import { useState } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { BookOpen } from 'lucide-react';
import { API_URL } from '../config';

export default function Register() {
  const navigate = useNavigate();
  const [formData, setFormData] = useState({
    name: '',
    email: '',
    password: '',
    schoolName: ''
  });

  const handleRegister = async (e) => {
    e.preventDefault();
    try {
      const response = await fetch(`${API_URL}/api/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData)
      });
      const data = await response.json();
      if(data.success) {
        localStorage.setItem('user', JSON.stringify(data.user));
        navigate('/teacher/dashboard');
      } else {
        alert("Registration failed: " + data.error);
      }
    } catch (e) {
      alert("Network Error");
    }
  };

  return (
    <div className="min-h-screen bg-brand-bg flex items-center justify-center p-4">
      <div className="max-w-md w-full bg-white rounded-2xl shadow-xl overflow-hidden">
        <div className="p-8 bg-brand-navy text-white text-center">
          <BookOpen className="w-12 h-12 mx-auto mb-4" />
          <h1 className="text-3xl font-bold mb-2">Create Account</h1>
          <p className="text-white/80">Join TulongGuro for AI-assisted grading</p>
        </div>

        <div className="p-8">
          <form onSubmit={handleRegister} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Full Name</label>
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
              <input
                type="password"
                required
                className="w-full px-4 py-2.5 rounded-lg border border-slate-200 focus:ring-2 focus:ring-brand-navy focus:border-transparent outline-none transition-all"
                placeholder="••••••••"
                onChange={(e) => setFormData({...formData, password: e.target.value})}
              />
            </div>
            
            <button
              type="submit"
              className="w-full py-3 mt-4 rounded-lg text-white font-medium bg-brand-navy hover:bg-blue-900 transition-all shadow-md"
            >
              Sign Up as Teacher
            </button>
          </form>

          <p className="text-center mt-6 text-sm text-slate-600">
            Already have an account?{' '}
            <Link to="/" className="text-brand-navy font-semibold hover:underline">
              Log in here
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
