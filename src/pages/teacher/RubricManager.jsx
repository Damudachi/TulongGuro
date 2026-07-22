import { useState, useEffect } from 'react';
import { ClipboardList, Check, ChevronDown, ChevronRight, Edit2, Trash2, Plus, X } from 'lucide-react';
import { API_URL } from '../../config';

// Helper for dynamic band colors based on label
const getBandColor = (label, index, totalBands) => {
  if (!label) return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
  const normalizedLabel = label.toLowerCase();
  
  if (normalizedLabel.includes('outstanding') || normalizedLabel.includes('excellent')) {
    return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
  }
  if (normalizedLabel.includes('proficient') || normalizedLabel.includes('very good')) {
    return { bg: 'bg-emerald-100', text: 'text-emerald-700', border: 'border-emerald-200' };
  }
  if (normalizedLabel.includes('good') || normalizedLabel.includes('developing') || normalizedLabel.includes('satisfactory')) {
    if (normalizedLabel.includes('satisfactory')) {
      return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' };
    }
    return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' };
  }
  if (normalizedLabel.includes('beginning') || normalizedLabel.includes('needs improvement') || normalizedLabel.includes('poor')) {
    return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
  }

  // Fallback by position
  if (totalBands > 1) {
    const ratio = index / (totalBands - 1);
    if (ratio <= 0.25) return { bg: 'bg-green-100', text: 'text-green-700', border: 'border-green-200' };
    if (ratio <= 0.5) return { bg: 'bg-blue-100', text: 'text-blue-700', border: 'border-blue-200' };
    if (ratio <= 0.75) return { bg: 'bg-amber-100', text: 'text-amber-700', border: 'border-amber-200' };
    return { bg: 'bg-red-100', text: 'text-red-700', border: 'border-red-200' };
  }
  
  return { bg: 'bg-slate-100', text: 'text-slate-700', border: 'border-slate-200' };
};

const detectRubricType = (rubric) => {
  if (rubric.type) return rubric.type;
  if (!rubric.criteria || !rubric.criteria.length) return 'standard';
  return rubric.criteria.some(c => c.bands && c.bands.length > 0) ? 'range' : 'standard';
};

const DEFAULT_RANGE_BANDS = [
  { label: 'Excellent', score: 5, description: 'Exceeds expectations.' },
  { label: 'Very Good', score: 4, description: 'Meets expectations.' },
  { label: 'Good', score: 3, description: 'Meets most expectations.' },
  { label: 'Satisfactory', score: 2, description: 'Partially meets.' },
  { label: 'Needs Improvement', score: 1, description: 'Does not meet.' },
];

export default function RubricManager() {
  const [expandedId, setExpandedId] = useState(null);
  const [savedRubrics, setSavedRubrics] = useState([]);
  const [prebuiltRubrics, setPrebuiltRubrics] = useState([]);
  const [teacherId, setTeacherId] = useState(null);

  // Edit State
  const [editingRubric, setEditingRubric] = useState(null);

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.id) {
      setTeacherId(user.id);
      fetchSavedRubrics(user.id);
    }
  }, []);

  useEffect(() => {
    fetch(`${API_URL}/api/rubric-templates/builtin`)
      .then(res => res.json())
      .then(data => { if (data.success && data.templates) setPrebuiltRubrics(data.templates); })
      .catch(() => {});
  }, []);

  const fetchSavedRubrics = async (tId) => {
    try {
      const res = await fetch(`${API_URL}/api/teacher/rubric-templates/${tId}`);
      if (res.ok) {
        const data = await res.json();
        const templates = data.templates || data || [];
        const parsed = (Array.isArray(templates) ? templates : []).map(r => ({
          ...r,
          criteria: typeof r.criteria === 'string' ? JSON.parse(r.criteria) : r.criteria
        })).filter(r => r.criteria && Array.isArray(r.criteria));
        setSavedRubrics(parsed);
      }
    } catch (e) {
      console.error('Failed to fetch rubrics:', e);
      setSavedRubrics([]);
    }
  };

  const toggleExpand = (id) => setExpandedId(prev => prev === id ? null : id);

  const isAlreadySaved = (name) => savedRubrics.some(r => r.name === name);

  const deleteRubric = async (id) => {
    if(!window.confirm("Are you sure you want to delete this custom rubric?")) return;
    try {
      const res = await fetch(`${API_URL}/api/teacher/rubric-templates/${id}`, { method: 'DELETE' });
      if(res.ok) fetchSavedRubrics(teacherId);
    } catch(e) {}
  };

  const startEditing = (rubric) => {
    setEditingRubric(JSON.parse(JSON.stringify(rubric))); // Deep copy
  };

  const saveEditedRubric = async () => {
    if(!editingRubric || !teacherId) return;
    const editType = detectRubricType(editingRubric);
    if (editType === 'standard') {
      const totalWeight = editingRubric.criteria.reduce((sum, c) => sum + (parseInt(c.points) || 0), 0);
      if(totalWeight !== 100) {
        alert(`Standard rubric weight must total 100%. Currently it is ${totalWeight}%.`);
        return;
      }
    }

    const isPrebuilt = prebuiltRubrics.some(r => r.id === editingRubric.id);
    
    try {
      if (isPrebuilt) {
        // Create new
        const res = await fetch(`${API_URL}/api/teacher/rubric-templates`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            teacherId,
            name: `${editingRubric.name} (Customized)`,
            description: editingRubric.description,
            gradeRange: editingRubric.gradeRange,
            criteria: editingRubric.criteria,
            isPublic: false
          })
        });
        if (res.ok) {
          setEditingRubric(null);
          fetchSavedRubrics(teacherId);
        }
      } else {
        // Update existing
        const res = await fetch(`${API_URL}/api/teacher/rubric-templates/${editingRubric._id || editingRubric.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(editingRubric)
        });
        if (res.ok) {
          setEditingRubric(null);
          fetchSavedRubrics(teacherId);
        }
      }
    } catch (e) {
      console.error(e);
      alert('Failed to save rubric');
    }
  };

  const renderRubricCard = (rubric, isCustom) => {
    if (!rubric || !rubric.criteria) return null;
    const isOpen = expandedId === (rubric._id || rubric.id);
    const saved = isCustom ? false : isAlreadySaved(rubric.name);
    const totalPoints = rubric.criteria.reduce((sum, c) => sum + (parseInt(c.points)||0), 0);
    const type = detectRubricType(rubric);

    return (
      <div key={rubric._id || rubric.id} className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
        <button onClick={() => toggleExpand(rubric._id || rubric.id)}
          className="w-full p-5 flex items-start justify-between text-left hover:bg-slate-50 transition-colors">
          <div className="flex-1">
            <div className="flex items-center gap-2 mb-1">
              <h3 className="font-bold text-brand-slate">{rubric.name}</h3>
              {type === 'standard' 
                ? <span className="text-[10px] font-bold px-2 py-0.5 bg-green-100 text-green-700 rounded-full">STANDARD</span>
                : <span className="text-[10px] font-bold px-2 py-0.5 bg-purple-100 text-purple-700 rounded-full">RANGE</span>
              }
              {saved && <span className="text-[10px] font-bold px-2 py-0.5 bg-blue-100 text-blue-700 rounded-full">SAVED</span>}
            </div>
            <p className="text-sm text-slate-500">{rubric.description}</p>
            <div className="flex gap-3 mt-2">
              <span className="text-xs font-medium text-slate-400">{rubric.gradeRange || 'All Grades'}</span>
              <span className="text-xs font-medium text-slate-400">•</span>
              <span className="text-xs font-medium text-slate-400">{rubric.criteria.length} criteria</span>
              <span className="text-xs font-medium text-slate-400">•</span>
              <span className="text-xs font-medium text-slate-400">{totalPoints} total {type === 'standard' ? '%' : 'pts'}</span>
            </div>
          </div>
          {isOpen ? <ChevronDown className="w-5 h-5 text-slate-400 mt-1 shrink-0" />
                   : <ChevronRight className="w-5 h-5 text-slate-400 mt-1 shrink-0" />}
        </button>

        {isOpen && (
          <div className="border-t border-slate-100 px-5 pb-5 pt-4">
            <div className="space-y-3 mb-5">
              {rubric.criteria.map((c, i) => (
                <div key={i} className="p-3 bg-slate-50 rounded-lg">
                  <div className="flex items-start gap-4">
                    <div className="w-12 h-12 rounded-lg bg-brand-navy/10 text-brand-navy flex items-center justify-center font-extrabold text-sm shrink-0">
                      {type === 'standard' ? `${c.points}%` : c.points}
                    </div>
                    <div className="flex-1">
                      <p className="font-semibold text-brand-slate text-sm">{c.name}</p>
                      <p className="text-xs text-slate-500 mt-0.5">{c.description}</p>
                    </div>
                  </div>
                  {/* Scoring Bands */}
                  {type === 'range' && c.bands && c.bands.length > 0 && (
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 ml-0 sm:ml-20">
                      {c.bands.map((band, bi) => {
                        const color = getBandColor(band.label, bi, c.bands.length);
                        return (
                          <div key={bi} className={`rounded-lg border ${color.border} bg-white p-2.5`}>
                            <div className="flex items-center gap-2 mb-1">
                              <span className="text-xs font-bold text-brand-slate">{band.score || band.range} pts</span>
                              <span className={`text-[10px] font-bold px-2 py-0.5 rounded-full ${color.bg} ${color.text}`}>{band.label}</span>
                            </div>
                            <p className="text-[11px] text-slate-500 leading-relaxed">{band.description}</p>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              ))}
            </div>
            <div className="flex gap-3">
              <button onClick={() => startEditing(rubric)}
                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium hover:bg-slate-200 transition-colors flex items-center gap-2">
                <Edit2 className="w-4 h-4" /> Edit Rubric
              </button>
              {isCustom && (
                <button onClick={() => deleteRubric(rubric._id)}
                  className="px-4 py-2 border border-red-200 text-red-600 rounded-lg text-sm font-medium hover:bg-red-50 transition-colors flex items-center gap-2">
                  <Trash2 className="w-4 h-4" /> Delete
                </button>
              )}
            </div>
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="p-4 md:p-8 max-w-5xl mx-auto pb-24">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-brand-slate flex items-center gap-2">
          <ClipboardList className="w-6 h-6 text-brand-navy" /> Grading Rubrics
        </h1>
        <p className="text-slate-500 text-sm mt-1">Manage standard and custom grading rubrics for your activities</p>
      </div>

      {savedRubrics.length > 0 && (
        <div className="mb-8">
          <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Your Saved Rubrics</h2>
          <div className="space-y-4">
            {savedRubrics.map(r => renderRubricCard(r, true))}
          </div>
        </div>
      )}

      <div className="mb-8">
        <h2 className="text-sm font-bold text-slate-500 uppercase tracking-wider mb-3">Pre-Built Rubrics</h2>
        <div className="space-y-4">
          {prebuiltRubrics.map(r => renderRubricCard(r, false))}
        </div>
      </div>

      {/* Full-Screen Edit Modal */}
      {editingRubric && (() => {
        const type = detectRubricType(editingRubric);
        return (
          <div className="fixed inset-0 bg-slate-100 z-50 overflow-y-auto">
            <div className="max-w-4xl mx-auto bg-white min-h-screen shadow-2xl relative flex flex-col">
              <div className="sticky top-0 bg-white border-b border-slate-200 p-4 flex items-center justify-between z-10">
                <h2 className="font-bold text-lg text-brand-slate flex items-center gap-2">
                  <Edit2 className="w-5 h-5 text-brand-navy" />
                  Edit Rubric {prebuiltRubrics.some(r => r.id === editingRubric.id) && <span className="text-xs font-normal text-slate-500">(Will save as custom)</span>}
                </h2>
                <button onClick={() => setEditingRubric(null)} className="p-2 hover:bg-slate-100 rounded-full text-slate-500">
                  <X className="w-5 h-5" />
                </button>
              </div>

              <div className="p-6 flex-1">
                <div className="mb-6">
                  <label className="block text-sm font-medium text-slate-700 mb-1">Rubric Name</label>
                  <input type="text" value={editingRubric.name} onChange={e => setEditingRubric({...editingRubric, name: e.target.value})}
                    className="w-full border border-slate-200 p-2.5 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-navy" />
                </div>

                <div className="space-y-3 mb-6">
                  <label className="block text-sm font-medium text-slate-700">Criteria</label>
                  {editingRubric.criteria.map((c, i) => (
                    <div key={i} className="p-3 border border-slate-200 rounded-lg bg-slate-50 space-y-3">
                      <div className="flex items-start gap-3">
                        <div className="flex-1 space-y-2">
                          <input type="text" value={c.name} onChange={e => {
                              const newC = [...editingRubric.criteria];
                              newC[i].name = e.target.value;
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="w-full p-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy font-bold" placeholder="Criterion name" />
                          <textarea value={c.description || ''} onChange={e => {
                              const newC = [...editingRubric.criteria];
                              newC[i].description = e.target.value;
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="w-full p-2 border border-slate-200 rounded text-sm focus:outline-none focus:ring-1 focus:ring-brand-navy text-slate-600 min-h-[60px]" placeholder="Description..." />
                        </div>
                        <div className="flex flex-col gap-2 w-24">
                          <div className="flex flex-col items-center gap-1">
                            <span className="text-xs font-bold text-slate-500 uppercase">{type === 'standard' ? 'Percent %' : 'Points'}</span>
                            <input type="number" value={c.points === 0 ? '' : c.points} onChange={e => {
                                const newC = [...editingRubric.criteria];
                                newC[i].points = e.target.value === '' ? 0 : parseInt(e.target.value) || 0;
                                setEditingRubric({...editingRubric, criteria: newC});
                              }}
                              className="w-full text-center font-bold text-lg p-2 border border-slate-300 rounded focus:outline-none focus:ring-2 focus:ring-brand-navy" />
                          </div>
                          <button onClick={() => {
                              const newC = editingRubric.criteria.filter((_, idx) => idx !== i);
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="text-red-500 hover:text-red-700 text-xs font-medium text-center p-1">
                            Remove
                          </button>
                        </div>
                      </div>

                      {type === 'range' && (
                        <div className="pl-4 border-l-2 border-purple-200 space-y-2 mt-2">
                          <p className="text-xs font-bold text-purple-700">Scoring Bands</p>
                          {c.bands?.map((b, bi) => (
                            <div key={bi} className="flex gap-2">
                              <input type="text" value={b.label} onChange={e => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands[bi].label = e.target.value;
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="w-1/4 p-1.5 text-xs border border-slate-200 rounded font-bold" placeholder="Label (e.g. Excellent)" />
                              <input type="number" value={b.score || ''} onChange={e => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands[bi].score = parseInt(e.target.value) || 0;
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="w-16 p-1.5 text-xs border border-slate-200 rounded text-center" placeholder="Pts" />
                              <input type="text" value={b.description || ''} onChange={e => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands[bi].description = e.target.value;
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="flex-1 p-1.5 text-xs border border-slate-200 rounded" placeholder="Band description..." />
                              <button onClick={() => {
                                  const newC = [...editingRubric.criteria];
                                  newC[i].bands = newC[i].bands.filter((_, bidx) => bidx !== bi);
                                  setEditingRubric({...editingRubric, criteria: newC});
                                }}
                                className="text-slate-400 hover:text-red-500 p-1.5">
                                <X className="w-4 h-4" />
                              </button>
                            </div>
                          ))}
                          <button onClick={() => {
                              const newC = [...editingRubric.criteria];
                              if (!newC[i].bands) newC[i].bands = [];
                              newC[i].bands.push({ label: 'New Band', score: 0, description: '' });
                              setEditingRubric({...editingRubric, criteria: newC});
                            }}
                            className="text-xs text-purple-600 hover:text-purple-800 font-medium flex items-center gap-1">
                            <Plus className="w-3 h-3" /> Add Band
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  
                  <button onClick={() => {
                      setEditingRubric({
                        ...editingRubric,
                        criteria: [...editingRubric.criteria, {
                          name: '', points: 0, description: '',
                          ...(type === 'range' ? { bands: JSON.parse(JSON.stringify(DEFAULT_RANGE_BANDS)) } : {})
                        }]
                      })
                    }}
                    className="w-full py-3 border-2 border-dashed border-slate-300 rounded-lg text-slate-500 font-medium hover:bg-slate-50 hover:border-brand-navy hover:text-brand-navy transition-colors flex items-center justify-center gap-2">
                    <Plus className="w-4 h-4" /> Add Criterion
                  </button>
                </div>
              </div>

              <div className="sticky bottom-0 bg-white border-t border-slate-200 p-4 flex items-center justify-between shadow-[0_-4px_6px_-1px_rgba(0,0,0,0.05)]">
                <div className="text-sm font-medium">
                  {type === 'standard' && (
                    <span className={editingRubric.criteria.reduce((s, c) => s + (parseInt(c.points)||0), 0) === 100 ? "text-green-600" : "text-amber-600"}>
                      Total Weight: {editingRubric.criteria.reduce((s, c) => s + (parseInt(c.points)||0), 0)}% (Must be 100%)
                    </span>
                  )}
                </div>
                <div className="flex gap-3">
                  <button onClick={() => setEditingRubric(null)} className="px-5 py-2.5 text-slate-600 font-medium hover:bg-slate-100 rounded-lg">
                    Cancel
                  </button>
                  <button onClick={saveEditedRubric} className="px-6 py-2.5 bg-brand-navy text-white font-bold rounded-lg hover:bg-blue-900 shadow-md">
                    Save Rubric
                  </button>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}
