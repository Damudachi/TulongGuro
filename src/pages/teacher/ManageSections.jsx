import { useState, useEffect } from 'react';
import { Users, Plus, Check } from 'lucide-react';

export default function ManageSections() {
  const [sections, setSections] = useState([]);
  const [name, setName] = useState('');
  const [studentsText, setStudentsText] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  useEffect(() => {
    fetchSections();
  }, []);

  const fetchSections = async () => {
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      if (!user) return;
      const res = await fetch(`http://localhost:3000/api/teacher/${user.id}/sections`);
      const data = await res.json();
      if (data.success) {
        setSections(data.sections);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const handleCreate = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    try {
      const user = JSON.parse(localStorage.getItem('user'));
      const studentNames = studentsText.split('\n').filter(s => s.trim());
      
      const res = await fetch('http://localhost:3000/api/teacher/sections', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name,
          teacherId: user.id,
          studentsList: studentNames
        })
      });
      const data = await res.json();
      
      if (data.success) {
        setName('');
        setStudentsText('');
        fetchSections();
        alert(`Successfully created section and generated ${data.createdStudents.length} student accounts!`);
      } else {
        alert("Error: " + data.error);
      }
    } catch (error) {
      alert("Network error.");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate">Manage Block Sections</h1>
        <p className="text-slate-500 text-sm">Create sections and auto-generate student accounts</p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-8">
        {/* Create Section Form */}
        <div className="bg-white p-6 rounded-2xl border border-slate-200 shadow-sm">
          <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center">
            <Plus className="w-5 h-5 mr-2 text-brand-navy" />
            Create New Section
          </h2>
          <form onSubmit={handleCreate} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Section Name</label>
              <input 
                type="text" 
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" 
                placeholder="e.g. Grade 10 - Rizal" 
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Student Names (One per line)</label>
              <textarea 
                required
                value={studentsText}
                onChange={(e) => setStudentsText(e.target.value)}
                rows={8}
                className="w-full px-4 py-2 border border-slate-200 rounded-lg focus:ring-2 focus:ring-brand-navy outline-none" 
                placeholder="Juan Dela Cruz&#10;Maria Clara&#10;Jose Rizal"
              ></textarea>
              <p className="text-xs text-slate-500 mt-1">
                The system will automatically generate a Student ID and default password ('password123') for each name.
              </p>
            </div>
            <button 
              type="submit" 
              disabled={isLoading}
              className="w-full py-3 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900 transition-colors disabled:opacity-50 flex items-center justify-center"
            >
              {isLoading ? 'Creating...' : 'Create Section & Accounts'}
            </button>
          </form>
        </div>

        {/* Existing Sections List */}
        <div>
          <h2 className="text-lg font-bold text-brand-slate mb-4 flex items-center">
            <Users className="w-5 h-5 mr-2 text-brand-navy" />
            Your Sections
          </h2>
          <div className="space-y-4">
            {sections.length === 0 ? (
              <div className="text-center p-8 border-2 border-dashed border-slate-200 rounded-2xl text-slate-500">
                No sections created yet.
              </div>
            ) : (
              sections.map(section => (
                <div key={section.id} className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex justify-between items-center group">
                  <div>
                    <h3 className="font-bold text-brand-slate">{section.name}</h3>
                    <p className="text-sm text-slate-500">{section._count?.students || 0} Students</p>
                  </div>
                  <div className="w-10 h-10 rounded-full bg-blue-50 text-brand-navy flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer">
                    <Check className="w-5 h-5" />
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
