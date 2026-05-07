import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, User, ArrowLeft, Clock, CheckCircle2, AlertCircle, UploadCloud } from 'lucide-react';
import { API_URL } from '../../config';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

const STATUS_CONFIG = {
  PENDING: { label: 'Needs Grading', color: 'bg-amber-100 text-amber-700', icon: Clock },
  GRADED: { label: 'Graded', color: 'bg-green-100 text-green-700', icon: CheckCircle2 },
  NONE: { label: 'No Submissions', color: 'bg-slate-100 text-slate-500', icon: AlertCircle },
};

export default function ClassHub() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('activities');
  const [classData, setClassData] = useState(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [showActivityForm, setShowActivityForm] = useState(false);
  const [newActivity, setNewActivity] = useState({ title: '', type: 'Essay', points: 100, instructions: '', deadline: '', submissionMode: 'TEACHER_UPLOAD' });

  useEffect(() => {
    fetch(`${API_URL}/api/classes/${classId}`)
      .then(r => r.json())
      .then(d => { if (d.success) setClassData(d.classData); })
      .finally(() => setIsLoading(false));
  }, [classId]);

  const handleCreateActivity = async (e) => {
    e.preventDefault();
    const res = await fetch(`${API_URL}/api/teacher/activities`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...newActivity, classId })
    });
    const data = await res.json();
    if (data.success) {
      setClassData(prev => ({ ...prev, activities: [data.activity, ...prev.activities] }));
      setShowActivityForm(false);
      setNewActivity({ title: '', type: 'Essay', points: 100, instructions: '', deadline: '', submissionMode: 'TEACHER_UPLOAD' });
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading class...</div>;
  if (!classData) return <div className="p-8 text-center text-slate-500">Class not found.</div>;

  const students = classData.section?.students || [];
  const activities = classData.activities || [];
  const filteredActivities = activities.filter(a => a.title.toLowerCase().includes(search.toLowerCase()));

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto relative min-h-full">
      <button onClick={() => navigate(-1)} className="flex items-center text-sm text-slate-500 hover:text-brand-slate mb-4">
        <ArrowLeft className="w-4 h-4 mr-1" /> Back to Dashboard
      </button>

      <div className="mb-6">
        <h1 className="text-2xl font-bold text-brand-slate">{classData.name}</h1>
        <p className="text-slate-500 text-sm">{classData.schoolYear} • {classData.section?.name} • {students.length} Students</p>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-slate-200 mb-6">
        {['activities', 'students'].map(tab => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={cn('pb-3 px-4 font-medium text-sm border-b-2 capitalize transition-colors',
              activeTab === tab ? 'border-brand-navy text-brand-navy' : 'border-transparent text-slate-500 hover:text-slate-700')}>
            {tab} {tab === 'students' ? `(${students.length})` : `(${activities.length})`}
          </button>
        ))}
      </div>

      {/* ACTIVITIES TAB */}
      {activeTab === 'activities' && (
        <div className="space-y-4">
          <div className="flex gap-3 mb-4 flex-wrap">
            <div className="relative flex-1 max-w-md">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input type="text" placeholder="Search activities..." value={search} onChange={e => setSearch(e.target.value)}
                className="w-full pl-10 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy" />
            </div>
            <button onClick={() => setShowActivityForm(true)}
              className="flex items-center bg-slate-100 text-slate-700 border border-slate-200 px-4 py-2 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors">
              <Plus className="w-4 h-4 mr-2" /> Quick Create
            </button>
            <Link to={`/teacher/activity/new?classId=${classId}`}
              className="flex items-center bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors">
              <Plus className="w-4 h-4 mr-2" /> Full Builder
            </Link>
          </div>

          {filteredActivities.length === 0 && (
            <div className="text-center py-16 border-2 border-dashed border-slate-200 rounded-2xl text-slate-400">
              <FileText className="w-12 h-12 mx-auto mb-3 opacity-30" />
              <p className="font-medium">No activities yet</p>
              <p className="text-sm">Create the first activity for this class</p>
            </div>
          )}

          {filteredActivities.map(activity => {
            const subCount = activity._count?.submissions || 0;
            const isStudentSubmit = activity.submissionMode === 'STUDENT_SUBMIT';
            // Show proper status: check if submissions exist and their status
            const pendingCount = activity.submissions?.filter(s => s.status === 'PENDING').length || 0;
            const gradedCount = activity.submissions?.filter(s => s.status === 'GRADED').length || 0;
            const cfg = subCount === 0 ? STATUS_CONFIG.NONE
              : pendingCount > 0 ? STATUS_CONFIG.PENDING
                : STATUS_CONFIG.GRADED;
            const StatusIcon = cfg.icon;
            const isPastDeadline = activity.deadline && new Date(activity.deadline) < new Date();
            return (
              <div key={activity.id} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between hover:shadow-sm transition-shadow">
                <div className="flex items-start">
                  <div className={`p-3 rounded-lg mr-4 shrink-0 ${isStudentSubmit ? 'bg-green-50' : 'bg-blue-50'}`}>
                    <FileText className={`w-6 h-6 ${isStudentSubmit ? 'text-brand-green' : 'text-brand-navy'}`} />
                  </div>
                  <div>
                    <div className="flex items-center gap-2 flex-wrap mb-0.5">
                      <h3 className="font-bold text-brand-slate">{activity.title}</h3>
                      <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${isStudentSubmit ? 'bg-green-100 text-green-700' : 'bg-blue-100 text-blue-700'}`}>
                        {isStudentSubmit ? '👤 Student Submits' : '📷 Teacher Uploads'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-500 mb-1">
                      {activity.type} • {activity.points} pts
                      {activity.deadline ? ` • Due ${new Date(activity.deadline).toLocaleDateString('en-PH', { month: 'short', day: 'numeric' })}` : ''}
                      {isPastDeadline && activity.deadline ? <span className="text-red-500 font-semibold"> (Closed)</span> : ''}
                    </p>
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${cfg.color}`}>
                      <StatusIcon className="w-3 h-3" />{cfg.label} {subCount > 0 && `(${subCount})`}
                    </span>
                  </div>
                </div>
                {isStudentSubmit ? (
                  <div className="flex flex-col gap-1 shrink-0">
                    <Link to={`/teacher/batch-upload?activityId=${activity.id}&classId=${classId}`}
                      className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 transition-colors flex items-center gap-1">
                      <UploadCloud className="w-3.5 h-3.5" /> Grade Papers
                    </Link>
                    <Link to={`/teacher/gradebook?classId=${classId}`}
                      className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-md font-medium hover:bg-slate-200 transition-colors text-center">
                      View Grades
                    </Link>
                  </div>
                ) : (
                  <Link to={`/teacher/batch-upload?activityId=${activity.id}&classId=${classId}`}
                    className="shrink-0 text-sm bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 transition-colors flex items-center gap-1">
                    <UploadCloud className="w-4 h-4" /> Grade
                  </Link>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* STUDENTS TAB */}
      {activeTab === 'students' && (
        <div className="space-y-3">
          {students.length === 0 ? (
            <div className="text-center py-16 text-slate-400 border-2 border-dashed rounded-2xl">No students in this section.</div>
          ) : students.map((s, i) => (
            <div key={s.id} className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between">
              <div className="flex items-center">
                <div className="w-9 h-9 rounded-full bg-blue-50 border border-blue-100 flex items-center justify-center text-brand-navy font-bold text-sm mr-4">
                  {s.name.charAt(0)}
                </div>
                <div>
                  <p className="font-medium text-brand-slate">{s.name}</p>
                  <p className="text-xs text-slate-500">ID: {s.username}</p>
                </div>
              </div>
              <span className="text-xs bg-slate-100 text-slate-600 px-2 py-1 rounded-full font-medium">#{i + 1}</span>
            </div>
          ))}
        </div>
      )}

      {/* New Activity Modal */}
      {showActivityForm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <h2 className="text-xl font-bold text-brand-slate mb-4">Create New Activity</h2>
            <form onSubmit={handleCreateActivity} className="space-y-4">
              <div>
                <label className="block text-sm font-medium mb-1">Title</label>
                <input required value={newActivity.title} onChange={e => setNewActivity({ ...newActivity, title: e.target.value })}
                  className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy" placeholder="e.g. Noli Me Tangere Reflection" />
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-medium mb-1">Type</label>
                  <select value={newActivity.type} onChange={e => setNewActivity({ ...newActivity, type: e.target.value })}
                    className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy">
                    {['Essay', 'Short Answer', 'Journal', 'Reflection', 'Quiz'].map(t => <option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-1">Points</label>
                  <input type="number" value={newActivity.points} onChange={e => setNewActivity({ ...newActivity, points: e.target.value })}
                    className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Deadline</label>
                <input type="date" value={newActivity.deadline} onChange={e => setNewActivity({ ...newActivity, deadline: e.target.value })}
                  className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy" />
              </div>
              <div>
                <label className="block text-sm font-medium mb-1">Instructions</label>
                <textarea value={newActivity.instructions} onChange={e => setNewActivity({ ...newActivity, instructions: e.target.value })}
                  rows={3} className="w-full border p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy resize-none"
                  placeholder="Write your instructions here..." />
              </div>
              {/* Submission Mode */}
              <div>
                <label className="block text-sm font-medium mb-2">Who submits the output?</label>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setNewActivity({ ...newActivity, submissionMode: 'TEACHER_UPLOAD' })}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all text-left ${newActivity.submissionMode === 'TEACHER_UPLOAD' ? 'border-brand-navy bg-blue-50 text-brand-navy' : 'border-slate-200 text-slate-600'}`}>
                    📷 Teacher Uploads
                    <p className="text-xs font-normal mt-0.5 text-slate-500">Teacher scans student papers</p>
                  </button>
                  <button type="button" onClick={() => setNewActivity({ ...newActivity, submissionMode: 'STUDENT_SUBMIT' })}
                    className={`p-3 rounded-lg border-2 text-sm font-medium transition-all text-left ${newActivity.submissionMode === 'STUDENT_SUBMIT' ? 'border-brand-green bg-green-50 text-brand-green' : 'border-slate-200 text-slate-600'}`}>
                    👤 Student Submits
                    <p className="text-xs font-normal mt-0.5 text-slate-500">Students upload from dashboard</p>
                  </button>
                </div>
              </div>
              <div className="flex gap-2 pt-2">
                <button type="button" onClick={() => setShowActivityForm(false)}
                  className="flex-1 py-2 border border-slate-200 rounded-lg text-slate-600 font-medium hover:bg-slate-50">Cancel</button>
                <button type="submit" className="flex-1 py-2 bg-brand-navy text-white rounded-lg font-medium hover:bg-blue-900">Create Activity</button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
