import { useState, useEffect } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { Plus, Search, FileText, ArrowLeft, Clock, CheckCircle2, AlertCircle, UploadCloud, Trash2, PenLine, CloudOff, Eye, ShieldCheck } from 'lucide-react';
import { API_URL, apiFetch } from '../../config';
import { submissionWindow, formatDeadline } from '../../utils/deadlines';
import { getStoredUser } from '../../utils/session';
import { saveClassSnapshot, readClassSnapshot } from '../../utils/offlineSnapshot';

function cn(...cls) { return cls.filter(Boolean).join(' '); }

/**
 * Whether a mark has already been recorded against this activity's rubric.
 *
 * hitlScore is stored as a percentage of the activity total, so once one paper
 * is GRADED both the rubric and the points total are part of what that mark
 * means — moving either re-values work that has already been assessed. The
 * server refuses it as well (409 GRADES_RECORDED); this only keeps a teacher
 * from spending ten minutes on an edit that was never going to save.
 */
const hasGradedWork = (activity) => !!activity?.submissions?.some(s => s.status === 'GRADED');

const STATUS_CONFIG = {
  NEEDS_GRADING:    { label: 'Needs Grading',    color: 'bg-amber-100 text-amber-700',  icon: Clock },
  NEEDS_VALIDATION: { label: 'Needs Validation', color: 'bg-orange-100 text-orange-700', icon: ShieldCheck },
  RELEASED:         { label: 'Graded & Released', color: 'bg-green-100 text-green-700',   icon: CheckCircle2 },
  NONE:             { label: 'No Submissions',    color: 'bg-slate-100 text-slate-500',   icon: AlertCircle },
};

export default function ClassHub() {
  const { classId } = useParams();
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState('activities');
  const [classData, setClassData] = useState(null);
  // Could not ask, as opposed to asked and told no. See the render below.
  const [loadFailed, setLoadFailed] = useState(false);
  // Set when this class came off the device, so the page can qualify what it
  // shows and hide the actions that need a server to be honest about.
  const [savedAt, setSavedAt] = useState(null);
  const [search, setSearch] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editActivity, setEditActivity] = useState(null);
  // No `points` — see the read-only field in the edit modal below.
  const [editForm, setEditForm] = useState({ title: '', type: 'Essay', topic: '', deadline: '', instructions: '' });
  const [deleteConfirmText, setDeleteConfirmText] = useState('');
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  useEffect(() => {
    apiFetch(`${API_URL}/api/classes/${classId}`)
      .then(r => r.json())
      .then(d => {
        if (!d.success) return;
        setClassData(d.classData);
        saveClassSnapshot(getStoredUser().id, classId, d.classData);
      })
      // "Class not found." is a claim about the class. Offline the app knows
      // nothing about whether it exists — only that it could not ask — and a
      // teacher who has just been shown the class on their dashboard reads
      // that message as their work having been deleted.
      .catch(() => {
        const snapshot = readClassSnapshot(getStoredUser().id, classId);
        if (!snapshot) return setLoadFailed(true);
        setClassData(snapshot);
        setSavedAt(snapshot.savedAt);
      })
      .finally(() => setIsLoading(false));
  }, [classId]);

  const openEditModal = (activity) => {
    setEditActivity(activity);
    setEditForm({
      title: activity.title || '',
      type: activity.type || 'Essay',
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
      const res = await apiFetch(`${API_URL}/api/teacher/activities/${editActivity.id}`,
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
    } catch {
      alert('Network error');
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleDeleteActivity = async () => {
    if (deleteConfirmText !== 'DELETE') return;
    setIsDeleting(true);
    try {
      const res = await apiFetch(`${API_URL}/api/teacher/activities/${editActivity.id}`, { method: 'DELETE' });
      const data = await res.json();
      if (data.success) {
        setClassData(prev => ({ ...prev, activities: prev.activities.filter(a => a.id !== editActivity.id) }));
        closeEditModal();
      } else {
        alert('Failed: ' + data.error);
      }
    } catch {
      alert('Network error');
    } finally {
      setIsDeleting(false);
    }
  };

  if (isLoading) return <div className="flex items-center justify-center h-64 text-slate-400">Loading class...</div>;
  if (!classData && loadFailed) return (
    <div className="p-8 max-w-md mx-auto text-center">
      <CloudOff className="w-10 h-10 mx-auto mb-3 text-navy-300" />
      <p className="font-display text-lg font-extrabold text-navy-700 mb-1">Can't open this class right now</p>
      <p className="text-sm text-navy-500 leading-relaxed">
        You appear to be offline. Your class is still here — its activities and learners need a connection to load.
        Queued uploads are safe and will send when you're back.
      </p>
    </div>
  );
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
      </div>

      {savedAt && (
        <div className="mb-6 bg-sun-100 border-2 border-sun-200 rounded-2xl p-4 flex items-start gap-3">
          <CloudOff className="w-5 h-5 text-sun-700 shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-extrabold text-navy-700">You're offline — saved copy of this class</p>
            <p className="text-sm text-navy-600 mt-0.5 leading-relaxed">
              From {new Date(savedAt).toLocaleDateString('en-PH', { month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.
              You can upload against these activities and they'll send when you're back. Grades and submission
              counts aren't available offline, and creating or editing an activity needs a connection.
            </p>
          </div>
        </div>
      )}

      {/* Left-over sandbox from the removed auto-seed. Nothing creates these
          any more, so this banner exists only to get the remaining ones
          cleared — hence "left over" rather than an invitation to explore. */}
      {classData.name.includes('[DEMO]') && (
        <div className="mb-6 bg-amber-50 border-2 border-amber-200 rounded-xl p-4 flex items-center justify-between">
          <div>
            <p className="font-bold text-amber-800 text-sm">🧪 Left-over sample class</p>
            <p className="text-xs text-amber-600">
              An older version of TulongGuro created this automatically. It holds no real learner work — the
              &ldquo;Demo Student&rdquo; and its marks are made up. Safe to delete.
            </p>
          </div>
          <button
            onClick={async () => {
              if (!confirm('Delete all demo data? This cannot be undone.')) return;
              try {
                const res = await apiFetch(`${API_URL}/api/teacher/demo-data/${classId}`, { method: 'DELETE' });
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
            // Four-way breakdown of submission states.
            const needsGradingCount = activity.submissions?.filter(s => s.status === 'PENDING' && (s.aiScore === null || s.aiScore === undefined)).length || 0;
            const needsValidationCount = activity.submissions?.filter(s => s.status === 'PENDING' && s.aiScore !== null && s.aiScore !== undefined).length || 0;
            const releasedCount = activity.submissions?.filter(s => s.status === 'GRADED' && s.releasedAt).length || 0;
            const validatedCount = activity.submissions?.filter(s => s.status === 'GRADED' && !s.releasedAt).length || 0;
            // The same window the four student screens read. Computing "closed"
            // from the deadline alone ignored lateUntil, so an activity students
            // could still submit to was labelled Closed to their teacher.
            const subWindow = submissionWindow(activity);
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
                      {activity.deadline ? ` • Due ${formatDeadline(activity.deadline)}` : ''}
                      {activity.deadline && subWindow.isClosed && (
                        <span className="text-red-500 font-semibold"> (Closed)</span>
                      )}
                      {activity.deadline && !subWindow.isClosed && subWindow.isLate && (
                        <span className="text-amber-600 font-semibold">
                          {' '}(Late accepted until {formatDeadline(activity.lateUntil)})
                        </span>
                      )}
                    </p>
                    <div className="flex items-center gap-1.5 flex-wrap">
                      {subCount === 0 ? (
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.NONE.color}`}>
                          <AlertCircle className="w-3 h-3" />{STATUS_CONFIG.NONE.label}
                        </span>
                      ) : (
                        <>
                          {needsGradingCount > 0 && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.NEEDS_GRADING.color}`}>
                              <Clock className="w-3 h-3" />Needs Grading ({needsGradingCount})
                            </span>
                          )}
                          {needsValidationCount > 0 && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.NEEDS_VALIDATION.color}`}>
                              <ShieldCheck className="w-3 h-3" />Needs Validation ({needsValidationCount})
                            </span>
                          )}
                          {validatedCount > 0 && (
                            <span className="text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 bg-blue-100 text-blue-700">
                              <Eye className="w-3 h-3" />Validated ({validatedCount})
                            </span>
                          )}
                          {releasedCount > 0 && (
                            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full flex items-center w-fit gap-1 ${STATUS_CONFIG.RELEASED.color}`}>
                              <CheckCircle2 className="w-3 h-3" />Graded & Released ({releasedCount})
                            </span>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
                {activity.submissionMode === 'MANUAL_SCORE' ? (
                  // No papers to scan — this one goes straight to the score sheet.
                  <Link to={`/teacher/scores?activityId=${activity.id}&classId=${classId}`}
                    onClick={(e) => e.stopPropagation()}
                    className="shrink-0 text-sm bg-lilac-500 text-white px-3 py-1.5 rounded-md font-medium hover:bg-lilac-600 transition-colors flex items-center gap-1">
                    <PenLine className="w-4 h-4" /> Enter Scores
                  </Link>
                ) : isStudentSubmit ? (
                  <div className="flex flex-col gap-1 shrink-0">
                    <Link to={`/teacher/batch-upload?activityId=${activity.id}&classId=${classId}`}
                      onClick={(e) => e.stopPropagation()}
                      className="text-xs bg-brand-navy text-white px-3 py-1.5 rounded-md font-medium hover:bg-blue-900 transition-colors flex items-center gap-1">
                      <UploadCloud className="w-3.5 h-3.5" /> Grade & View
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
                    className="flex-1 min-w-0 border border-red-200 p-2 rounded-lg outline-none focus:ring-2 focus:ring-red-500"
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
                {/* Read-only, and left out of the save entirely.
                    The points total is one half of what a rubric criterion is
                    worth, so a quick edit is the wrong place to move it — the
                    weights live next to it in Advanced Edit, where both can be
                    seen at once. */}
                <div className="flex-1">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Points</label>
                  <div className="w-full border border-slate-200 bg-slate-50 p-2 rounded-lg text-slate-600 font-medium">
                    {editActivity.points} pts
                  </div>
                  <p className="text-xs text-slate-400 mt-1">Changed in Advanced Edit, with the rubric</p>
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
                {hasGradedWork(editActivity) ? (
                  <div
                    className="w-full text-center py-2 rounded-lg border border-slate-200 bg-slate-50 text-slate-400 font-medium mt-2 cursor-not-allowed"
                    title="Papers have already been marked against this rubric. Changing it now would re-value marks that have been recorded."
                  >
                    Rubric Locked (Work Already Graded)
                  </div>
                ) : (
                  <Link
                    to={`/teacher/activity/edit/${editActivity.id}?classId=${classId}`}
                    className="w-full text-center py-2 rounded-lg border border-brand-navy text-brand-navy font-medium hover:bg-blue-50 mt-2"
                  >
                    Advanced Edit (Edit Rubric)
                  </Link>
                )}
              </div>
            </form>
          </div>
        </div>
      )}

    </div>
  );
}
