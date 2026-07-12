import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, User, ArrowLeft, Clock, CheckCircle2, AlertCircle, UploadCloud, Trash2, Eye, X } from 'lucide-react';
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
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editActivity, setEditActivity] = useState(null);
  const [editForm, setEditForm] = useState({ title: '', type: 'Essay', points: 100, topic: '', deadline: '', instructions: '' });
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [showPreview, setShowPreview] = useState(false);

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

  const openEditModal = (activity) => {
    setEditActivity(activity);
    setEditForm({
      title: activity.title || '',
      type: activity.type || 'Essay',
      points: activity.points || 100,
      topic: activity.topic || '',
      deadline: activity.deadline ? String(activity.deadline).split('T')[0] : '',
      instructions: activity.instructions || ''
    });
    setDeleteConfirmText('');
    setShowDeleteConfirm(false);
    setIsEditOpen(true);
  };

  const closeEditModal = () => {
    setIsEditOpen(false);
    setEditActivity(null);
  };

  const handleSaveEdit = async (e) => {
    e.preventDefault();
    if (!editActivity) return;
    setIsSavingEdit(true);
    try {
      const res = await fetch(`${API_URL}/api/teacher/activities/${editActivity.id}`,
        {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editForm)
        }
      );
      const data = await res.json();
      if (data.success) {
        setClassData(prev => ({
          ...prev,
          activities: prev.activities.map(a => a.id === editActivity.id ? data.activity : a)
        }));
        closeEditModal();
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Network error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteActivity = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setIsDeleting(true);
    try {
      const res = await fetch(`${API_URL}/api/teacher/activities/${editActivity.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setClassData(prev => ({ ...prev, activities: prev.activities.filter(a => a.id !== editActivity.id) }));
        closeEditModal();
      } else {
        alert('Failed: ' + data.error);
      }
    } catch (e) {
      alert('Network error');
    } finally {
      setIsDeleting(false);
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

      <div className="mb-6 flex items-start justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-brand-slate">{classData.name}</h1>
          <p className="text-slate-500 text-sm">{classData.schoolYear} • {classData.section?.name} • {students.length} Students</p>
        </div>
        <button
          onClick={() => setShowPreview(true)}
          className="flex items-center gap-1.5 text-sm font-medium text-brand-navy bg-blue-50 hover:bg-blue-100 border border-blue-200 px-3 py-1.5 rounded-lg transition-colors"
        >
          <Eye className="w-4 h-4" /> 👁 Preview Student View
        </button>
      </div>

      {/* Demo Data Banner */}
      {classData.name.includes('[DEMO]') && (
        <div className="mb-6 bg-amber-50 border-2 border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-amber-800 text-sm">🧪 This is a Demo Class</p>
            <p className="text-xs text-amber-600">Explore the AI grading workflow here. When you're ready for real data, delete this sandbox.</p>
          </div>
          <button
            onClick={async () => {
              if (!confirm('Delete all demo data? This cannot be undone.')) return;
              try {
                const res = await fetch(`${API_URL}/api/teacher/demo-data/${classId}`, { method: 'DELETE' });
                const data = await res.json();
                if (data.success) navigate('/teacher/dashboard');
                else alert('Error: ' + data.error);
              } catch { alert('Network error'); }
            }}
            className="shrink-0 bg-red-500 hover:bg-red-600 text-white text-sm font-bold px-4 py-2 rounded-lg flex items-center gap-2 transition-colors shadow-sm"
          >
            <Trash2 className="w-4 h-4" /> Delete Demo Data
          </button>
        </div>
      )}

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
            <Link to={`/teacher/activity/new?classId=${classId}`}
              className="flex items-center bg-brand-navy text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-blue-900 transition-colors">
              <Plus className="w-4 h-4 mr-2" /> Create Activity
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
            const subCount = activity.submissions?.length ?? activity._count?.submissions ?? 0;
            const isStudentSubmit = activity.submissionMode === 'STUDENT_SUBMIT';
            // Show proper status: check if submissions exist and their status
            const pendingCount = activity.submissions?.filter(s => s.status === 'PENDING').length || 0;
            const gradedCount = activity.submissions?.filter(s => s.status === 'GRADED').length || 0;
            const isPastDeadline = activity.deadline && new Date(activity.deadline) < new Date();
            return (
              <div
                key={activity.id}
                role="button"
                tabIndex={0}
                onClick={() => openEditModal(activity)}
                onKeyDown={(e) => { if (e.key === 'Enter') openEditModal(activity); }}
                className="bg-white p-4 rounded-xl border border-slate-200 flex items-center justify-between hover:shadow-sm transition-shadow cursor-pointer"
              >
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
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {subCount === 0 ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.NONE.color}`}>
                          <AlertCircle className="w-3 h-3" />{STATUS_CONFIG.NONE.label}
                        </span>
                      ) : (
                        <>
                          {pendingCount > 0 && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.PENDING.color}`}>
                              <Clock className="w-3 h-3" />Needs Grading ({pendingCount})
                            </span>
                          )}
                          {gradedCount > 0 && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.GRADED.color}`}>
                              <CheckCircle2 className="w-3 h-3" />Graded ({gradedCount})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {isStudentSubmit ? (
                  <div className="flex flex-col gap-1 shrink-0">
                    <Link to={`/teacher/batch-upload?activityId=${activity.id}&classId=${classId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 transition-colors flex items-center gap-1">
                      <UploadCloud className="w-3.5 h-3.5" /> Grade Papers
                    </Link>
                    <Link to={`/teacher/gradebook/class/${classId}?activityId=${activity.id}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs bg-slate-100 text-slate-700 px-3 py-1.5 rounded-md font-medium hover:bg-slate-200 transition-colors text-center">
                      View Grades
                    </Link>
                  </div>
                ) : (
                  <Link to={`/teacher/batch-upload?activityId=${activity.id}&classId=${classId}`}
                    onClick={(e) => e.stopPropagation()}
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

      {/* Edit Activity Modal */}
      {isEditOpen && editActivity && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl p-6 w-full max-w-lg shadow-xl">
            <div className="mb-4 flex justify-between items-start">
              <div>
                <h2 className="text-xl font-bold text-brand-slate">Assignment Details</h2>
                <p className="text-xs text-slate-500">Update the details for this activity.</p>
              </div>
              {editActivity?._count?.submissions > 0 ? (
                <div className="text-xs text-slate-400 font-medium px-3 py-1.5 bg-slate-50 border border-slate-200 rounded-lg cursor-not-allowed" title="Cannot delete because students have already uploaded submissions.">
                  Cannot Delete (Has Submissions)
                </div>
              ) : (
                <button onClick={() => setShowDeleteConfirm(!showDeleteConfirm)} className="text-red-500 text-sm font-semibold hover:text-red-700">
                  Delete Activity
                </button>
              )}
            </div>

            {showDeleteConfirm && !editActivity?._count?.submissions && (
              <div className="bg-red-50 border border-red-200 rounded-xl p-4 mb-4">
                <p className="text-sm text-red-800 font-bold mb-2">Are you sure? This action cannot be undone.</p>
                <label className="block text-xs font-medium text-red-700 mb-1">Type "DELETE" to confirm</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    value={deleteConfirmText}
                    onChange={(e) => setDeleteConfirmText(e.target.value)}
                    className="flex-1 border border-red-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-red-500"
                    placeholder="DELETE"
                  />
                  <button
                    type="button"
                    onClick={handleDeleteActivity}
                    disabled={deleteConfirmText !== 'DELETE' || isDeleting}
                    className="bg-red-600 text-white font-bold px-4 rounded-lg hover:bg-red-700 disabled:opacity-50"
                  >
                    {isDeleting ? 'Deleting...' : 'Confirm'}
                  </button>
                </div>
              </div>
            )}

            <form onSubmit={handleSaveEdit} className="space-y-4 max-h-[60vh] overflow-y-auto px-1">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Title</label>
                <input
                  type="text"
                  required
                  value={editForm.title}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, title: e.target.value }))}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy"
                />
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
                  <select
                    value={editForm.type}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, type: e.target.value }))}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy"
                  >
                    <option value="Essay">Essay</option>
                    <option value="Journal">Journal</option>
                    <option value="Reflection">Reflection</option>
                    <option value="Short Story">Short Story</option>
                  </select>
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Points</label>
                  <input
                    type="number"
                    required
                    min="1"
                    value={editForm.points}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, points: parseInt(e.target.value) || 0 }))}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy"
                  />
                </div>
              </div>
              <div className="flex gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Topic (Optional)</label>
                  <input
                    type="text"
                    value={editForm.topic}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, topic: e.target.value }))}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy"
                    placeholder="e.g. Noli Me Tangere"
                  />
                </div>
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Deadline</label>
                  <input
                    type="date"
                    value={editForm.deadline}
                    onChange={(e) => setEditForm((prev) => ({ ...prev, deadline: e.target.value }))}
                    className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy"
                  />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1">Details</label>
                <textarea
                  rows={4}
                  value={editForm.instructions}
                  onChange={(e) => setEditForm((prev) => ({ ...prev, instructions: e.target.value }))}
                  className="w-full border border-slate-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-brand-navy resize-none"
                  placeholder="Add or update assignment details for students..."
                />
              </div>
              <div className="flex flex-col gap-2 pt-2 pb-2">
                <div className="flex gap-2">
                  <button
                    type="button"
                    onClick={closeEditModal}
                    className="flex-1 py-2 rounded-lg border border-slate-200 text-slate-600 font-medium hover:bg-slate-50"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingEdit}
                    className="flex-1 py-2 rounded-lg bg-brand-navy text-white font-medium hover:bg-blue-900 disabled:opacity-70"
                  >
                    {isSavingEdit ? 'Saving...' : 'Quick Save'}
                  </button>
                </div>
                <Link
                  to={`/teacher/activity/edit/${editActivity.id}?classId=${classId}`}
                  className="w-full text-center py-2 rounded-lg border border-brand-navy text-brand-navy font-medium hover:bg-blue-50 mt-2"
                >
                  Advanced Edit (Edit Rubric)
                </Link>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Preview Student View Modal */}
      {showPreview && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4" onClick={() => setShowPreview(false)}>
          <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl max-h-[90vh] overflow-y-auto" onClick={e => e.stopPropagation()}>
            {/* Modal Header */}
            <div className="sticky top-0 bg-white rounded-t-2xl border-b border-slate-100 px-6 py-4 flex items-center justify-between z-10">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-blue-50">
                  <Eye className="w-5 h-5 text-brand-navy" />
                </div>
                <h2 className="text-lg font-bold text-brand-slate">How Students See Their Feedback</h2>
              </div>
              <button onClick={() => setShowPreview(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors">
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Mock Student Feedback Card */}
            <div className="p-6 space-y-5">
              {/* Submission Header */}
              <div className="bg-gradient-to-br from-blue-50 to-green-50 rounded-xl border border-slate-200 p-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-xs font-semibold text-brand-navy uppercase tracking-wide mb-1">Activity</p>
                    <h3 className="font-bold text-brand-slate text-lg">Noli Me Tangere Reflection</h3>
                    <p className="text-sm text-slate-500">Filipino 10 — Grade 10</p>
                  </div>
                  {/* Score Ring */}
                  <div className="relative w-16 h-16 shrink-0">
                    <svg className="w-16 h-16 -rotate-90" viewBox="0 0 64 64">
                      <circle cx="32" cy="32" r="28" fill="none" stroke="#e2e8f0" strokeWidth="5" />
                      <circle cx="32" cy="32" r="28" fill="none" stroke="#22c55e" strokeWidth="5"
                        strokeDasharray={`${(85 / 100) * 175.93} 175.93`} strokeLinecap="round" />
                    </svg>
                    <div className="absolute inset-0 flex items-center justify-center">
                      <span className="text-sm font-bold text-brand-slate">85<span className="text-[10px] text-slate-400">/100</span></span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Strengths */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">💪</span>
                  <h4 className="font-bold text-brand-slate text-sm">Strengths</h4>
                </div>
                <div className="bg-green-50 border border-green-200 rounded-xl p-3">
                  <p className="text-sm text-green-800">Napakagaling! Your reflection showed a deep understanding of Crisostomo Ibarra's motivations.</p>
                </div>
              </div>

              {/* Areas for Growth */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🌱</span>
                  <h4 className="font-bold text-brand-slate text-sm">Areas for Growth</h4>
                </div>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-3">
                  <div className="border-l-4 border-amber-400 pl-3">
                    <p className="text-sm text-amber-900 italic mb-1">"Ibarra is want to change the Philippines"</p>
                    <p className="text-sm text-amber-800">Try: <span className="font-semibold">"Ibarra wants to change the Philippines."</span> Notice how 'want' becomes 'wants' when the subject is he or she.</p>
                  </div>
                </div>
              </div>

              {/* Action Steps */}
              <div>
                <div className="flex items-center gap-2 mb-2">
                  <span className="text-lg">🎯</span>
                  <h4 className="font-bold text-brand-slate text-sm">Action Steps</h4>
                </div>
                <div className="bg-blue-50 border border-blue-200 rounded-xl p-3">
                  <p className="text-sm text-blue-800">Rewrite your opening sentence to start with a hook question.</p>
                </div>
              </div>

              {/* Bottom Note */}
              <div className="bg-slate-50 rounded-xl p-3 border border-slate-200 flex items-start gap-2">
                <span className="text-base mt-0.5">ℹ️</span>
                <p className="text-xs text-slate-500 leading-relaxed">
                  Students see encouraging, age-appropriate feedback. The AI adapts its language to the grade level.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
