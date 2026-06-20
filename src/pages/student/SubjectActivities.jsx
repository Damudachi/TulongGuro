import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, CheckCircle, Clock, AlertCircle } from 'lucide-react';

export default function SubjectActivities() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const subjectId = searchParams.get('subject');

  const subjectNames = {
    1: 'Mathematics',
    2: 'English',
    3: 'Science',
    4: 'Social Studies',
  };

  const activities = [
    {
      id: 1,
      title: 'Quadratic Equations Assignment',
      dueDate: '2026-06-25',
      status: 'submitted',
      score: 92,
      feedback: 'Excellent work! Great understanding of the quadratic formula.',
    },
    {
      id: 2,
      title: 'Chapter 5 Review',
      dueDate: '2026-06-28',
      status: 'pending',
      score: null,
      feedback: null,
    },
    {
      id: 3,
      title: 'Problem Set 3',
      dueDate: '2026-06-22',
      status: 'submitted',
      score: 88,
      feedback: 'Good effort. Review the properties of exponents section.',
    },
    {
      id: 4,
      title: 'Algebra Quiz',
      dueDate: '2026-06-20',
      status: 'submitted',
      score: 95,
      feedback: 'Outstanding! Perfect score!',
    },
  ];

  const getStatusIcon = (status) => {
    if (status === 'submitted') return <CheckCircle className="w-5 h-5 text-green-500" />;
    if (status === 'pending') return <Clock className="w-5 h-5 text-yellow-500" />;
    return <AlertCircle className="w-5 h-5 text-red-500" />;
  };

  const getStatusColor = (status) => {
    if (status === 'submitted') return 'bg-green-50 border-green-200';
    if (status === 'pending') return 'bg-yellow-50 border-yellow-200';
    return 'bg-red-50 border-red-200';
  };

  return (
    <div className="min-h-screen bg-slate-50 p-4 md:p-8">
      <div className="max-w-4xl mx-auto">
        <button
          onClick={() => navigate('/student/subjects')}
          className="flex items-center text-brand-green font-semibold mb-6 hover:text-green-700"
        >
          <ArrowLeft className="w-5 h-5 mr-2" />
          Back to Subjects
        </button>

        <h1 className="text-3xl font-bold text-slate-800 mb-2">
          {subjectNames[subjectId] || 'Subject'} - Activities
        </h1>
        <p className="text-slate-600 mb-8">View all activities and assignments for this subject</p>

        <div className="space-y-4">
          {activities.map(activity => (
            <div
              key={activity.id}
              className={`border rounded-lg p-6 ${getStatusColor(activity.status)} hover:shadow-md transition-shadow`}
            >
              <div className="flex items-start justify-between mb-4">
                <div className="flex items-center gap-3 flex-1">
                  {getStatusIcon(activity.status)}
                  <div>
                    <h3 className="font-semibold text-slate-800 text-lg">{activity.title}</h3>
                    <p className="text-sm text-slate-600">Due: {new Date(activity.dueDate).toLocaleDateString()}</p>
                  </div>
                </div>
                {activity.score !== null && (
                  <div className="text-right">
                    <p className="text-3xl font-bold text-brand-green">{activity.score}</p>
                    <p className="text-xs text-slate-600">/ 100</p>
                  </div>
                )}
              </div>

              {activity.feedback && (
                <div className="bg-white rounded p-4 mt-4 border border-slate-200">
                  <p className="text-sm font-semibold text-slate-700 mb-2">Feedback:</p>
                  <p className="text-slate-700">{activity.feedback}</p>
                </div>
              )}

              {activity.status === 'pending' && (
                <div className="text-sm text-yellow-700 font-semibold mt-4">
                  Awaiting grading...
                </div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
