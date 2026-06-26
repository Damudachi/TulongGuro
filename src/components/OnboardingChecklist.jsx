import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { CheckCircle2, Circle, ChevronDown, ChevronUp, X, Sparkles, ClipboardList } from 'lucide-react';
import { hasSeenFlag, markFlagSeen, FLAGS } from '../utils/onboardingState';
import { API_URL } from '../config';

export default function OnboardingChecklist() {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isVisible, setIsVisible] = useState(false);
  const [stats, setStats] = useState({
    hasSections: false,
    hasStudents: false,
    hasGraded: false,
  });

  useEffect(() => {
    const user = JSON.parse(localStorage.getItem('user') || '{}');
    if (user.role !== 'TEACHER' || hasSeenFlag(FLAGS.ONBOARDING_CHECKLIST_DISMISSED)) {
      return;
    }

    // Fetch teacher stats to determine checklist completion
    const fetchStats = async () => {
      try {
        const res = await fetch(`${API_URL}/api/teacher/${user.id}/analytics`);
        const data = await res.json();
        if (data.success) {
          setStats({
            hasSections: data.sectionsCount > 1, // > 1 means non-demo sections exist
            hasStudents: data.studentsCount > 5, // > 5 means non-demo students exist
            hasGraded: data.totalGradedSubmissions > 0,
          });
          setIsVisible(true);
        }
      } catch (err) {
        console.error('Failed to fetch stats for checklist', err);
      }
    };

    fetchStats();
  }, []);

  const tasks = [
    { id: 'account', label: 'Create your account', completed: true, link: null },
    { id: 'demo', label: 'Explore the Demo Class', completed: hasSeenFlag(FLAGS.TEACHER_GUIDED_TOUR), link: '/teacher/dashboard' },
    { id: 'grade', label: 'Review an AI-graded essay', completed: stats.hasGraded, link: '/teacher/dashboard' },
    { id: 'section', label: 'Create your own section', completed: stats.hasSections, link: '/teacher/sections' },
    { id: 'students', label: 'Add real students', completed: stats.hasStudents, link: '/teacher/sections' },
  ];

  const completedCount = tasks.filter(t => t.completed).length;
  const isAllComplete = completedCount === tasks.length;

  useEffect(() => {
    if (isAllComplete && isVisible) {
      // Auto-dismiss after a few seconds of full completion
      const timer = setTimeout(() => {
        dismissChecklist();
      }, 5000);
      return () => clearTimeout(timer);
    }
  }, [isAllComplete, isVisible]);

  const dismissChecklist = () => {
    setIsVisible(false);
    markFlagSeen(FLAGS.ONBOARDING_CHECKLIST_DISMISSED);
  };

  if (!isVisible) return null;

  return (
    <div className="fixed bottom-4 left-4 md:bottom-8 md:left-8 z-[120] animate-fade-in-up">
      {/* Minimized View */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="bg-brand-navy text-white px-4 py-3 rounded-full shadow-xl border border-slate-700 flex items-center gap-3 hover:bg-blue-900 transition-colors"
        >
          <div className="relative">
            <ClipboardList className="w-5 h-5" />
            {completedCount < tasks.length && (
              <span className="absolute -top-1.5 -right-1.5 w-3 h-3 bg-red-500 rounded-full animate-pulse" />
            )}
          </div>
          <span className="text-sm font-bold">Getting Started ({completedCount}/{tasks.length})</span>
          <ChevronUp className="w-4 h-4 ml-1 opacity-70" />
        </button>
      )}

      {/* Expanded View */}
      {isExpanded && (
        <div className="bg-white rounded-2xl shadow-2xl border border-slate-200 w-80 overflow-hidden flex flex-col animate-fade-in-up">
          <div className="bg-brand-navy p-4 flex items-center justify-between">
            <div className="flex items-center text-white font-bold">
              <ClipboardList className="w-5 h-5 mr-2 text-blue-300" />
              Getting Started
            </div>
            <div className="flex items-center gap-2">
              <button onClick={() => setIsExpanded(false)} className="text-white/70 hover:text-white">
                <ChevronDown className="w-5 h-5" />
              </button>
              <button onClick={dismissChecklist} className="text-white/70 hover:text-white" title="Dismiss permanently">
                <X className="w-5 h-5" />
              </button>
            </div>
          </div>
          
          <div className="p-4 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
            <div className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Progress</div>
            <div className="text-xs font-bold text-brand-navy">{completedCount}/{tasks.length} Complete</div>
          </div>
          
          <div className="h-1 bg-slate-100 w-full">
            <div 
              className="h-1 bg-brand-green transition-all duration-500" 
              style={{ width: `${(completedCount / tasks.length) * 100}%` }}
            />
          </div>

          <div className="p-2">
            {tasks.map((task) => {
              const TaskContent = (
                <div className={`flex items-center p-3 rounded-xl transition-colors ${task.completed ? 'opacity-60' : 'hover:bg-blue-50 cursor-pointer'}`}>
                  {task.completed ? (
                    <CheckCircle2 className="w-5 h-5 text-brand-green mr-3 shrink-0" />
                  ) : (
                    <Circle className="w-5 h-5 text-slate-300 mr-3 shrink-0" />
                  )}
                  <span className={`text-sm ${task.completed ? 'text-slate-500 line-through' : 'text-brand-slate font-medium'}`}>
                    {task.label}
                  </span>
                </div>
              );

              return task.link && !task.completed ? (
                <Link key={task.id} to={task.link} onClick={() => setIsExpanded(false)}>
                  {TaskContent}
                </Link>
              ) : (
                <div key={task.id}>{TaskContent}</div>
              );
            })}
          </div>

          {isAllComplete && (
            <div className="p-4 bg-green-50 text-green-800 text-center text-sm font-bold border-t border-green-100 flex items-center justify-center gap-2">
              <Sparkles className="w-4 h-4 text-green-600" /> All done! You're ready to teach.
            </div>
          )}
        </div>
      )}
    </div>
  );
}
