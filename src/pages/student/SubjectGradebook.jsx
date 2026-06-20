import { useSearchParams, useNavigate } from 'react-router-dom';
import { ArrowLeft, TrendingUp } from 'lucide-react';

export default function SubjectGradebook() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const subjectId = searchParams.get('subject');

  const subjectNames = {
    1: 'Mathematics',
    2: 'English',
    3: 'Science',
    4: 'Social Studies',
  };

  const overallGrade = 91;
  const gradeScale = 'A';

  const activities = [
    {
      id: 1,
      title: 'Quadratic Equations Assignment',
      dueDate: '2026-06-25',
      score: 92,
      maxScore: 100,
      feedback: 'Excellent work! Great understanding of the quadratic formula.',
      type: 'Assignment',
    },
    {
      id: 2,
      title: 'Chapter 5 Review',
      dueDate: '2026-06-28',
      score: null,
      maxScore: 100,
      feedback: 'Still being graded',
      type: 'Review',
    },
    {
      id: 3,
      title: 'Problem Set 3',
      dueDate: '2026-06-22',
      score: 88,
      maxScore: 100,
      feedback: 'Good effort. Review the properties of exponents section.',
      type: 'Problem Set',
    },
    {
      id: 4,
      title: 'Algebra Quiz',
      dueDate: '2026-06-20',
      score: 95,
      maxScore: 100,
      feedback: 'Outstanding! Perfect score!',
      type: 'Quiz',
    },
    {
      id: 5,
      title: 'Midterm Exam',
      dueDate: '2026-06-15',
      score: 89,
      maxScore: 100,
      feedback: 'Solid performance. A few calculation errors.',
      type: 'Exam',
    },
  ];

  const getLetterGrade = (score) => {
    if (score >= 90) return 'A';
    if (score >= 80) return 'B';
    if (score >= 70) return 'C';
    if (score >= 60) return 'D';
    return 'F';
  };

  const getGradeColor = (score) => {
    if (score >= 90) return 'text-green-600 bg-green-50';
    if (score >= 80) return 'text-blue-600 bg-blue-50';
    if (score >= 70) return 'text-yellow-600 bg-yellow-50';
    if (score >= 60) return 'text-orange-600 bg-orange-50';
    return 'text-red-600 bg-red-50';
  };

  const submittedActivities = activities.filter(a => a.score !== null);

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
          {subjectNames[subjectId] || 'Subject'} - Gradebook
        </h1>
        <p className="text-slate-600 mb-8">Overall performance and detailed scores</p>

        {/* Overall Grade Card */}
        <div className="bg-white rounded-lg shadow-md p-8 mb-8">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-slate-600 text-lg font-semibold mb-2">Overall Grade</h2>
              <p className="text-slate-600">
                Based on {submittedActivities.length} graded {submittedActivities.length === 1 ? 'activity' : 'activities'}
              </p>
            </div>
            <div className="text-right">
              <div className="text-6xl font-bold leading-none text-brand-green">
                {overallGrade}%
              </div>
              <div className="text-3xl font-bold leading-none mt-1 text-brand-green">
                {gradeScale}
              </div>
            </div>
          </div>

          {/* Progress Bar */}
          <div className="mt-6 w-full bg-slate-200 rounded-full h-4">
            <div
              className="bg-brand-green h-4 rounded-full transition-all"
              style={{ width: `${overallGrade}%` }}
            ></div>
          </div>
        </div>

        {/* Grade Distribution Stats */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4 mb-8">
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-slate-600 text-sm font-semibold mb-2">Highest Score</p>
            <p className="text-2xl font-bold text-green-600">95%</p>
            <p className="text-xs text-slate-500">Algebra Quiz</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-slate-600 text-sm font-semibold mb-2">Average Score</p>
            <p className="text-2xl font-bold text-blue-600">{Math.round(submittedActivities.reduce((sum, a) => sum + a.score, 0) / submittedActivities.length)}%</p>
            <p className="text-xs text-slate-500">All activities</p>
          </div>
          <div className="bg-white rounded-lg shadow p-4">
            <p className="text-slate-600 text-sm font-semibold mb-2">Lowest Score</p>
            <p className="text-2xl font-bold text-orange-600">88%</p>
            <p className="text-xs text-slate-500">Problem Set 3</p>
          </div>
        </div>

        {/* Activities Breakdown */}
        <h2 className="text-2xl font-bold text-slate-800 mb-4">Activity Scores & Feedback</h2>
        <div className="space-y-4">
          {activities.map(activity => (
            <div key={activity.id} className="bg-white rounded-lg shadow p-6 hover:shadow-lg transition-shadow">
              <div className="flex items-start justify-between mb-4">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-2">
                    <h3 className="font-semibold text-slate-800 text-lg">{activity.title}</h3>
                    <span className="text-xs bg-slate-200 text-slate-700 px-2 py-1 rounded">
                      {activity.type}
                    </span>
                  </div>
                  <p className="text-sm text-slate-600">Due: {new Date(activity.dueDate).toLocaleDateString()}</p>
                </div>
                {activity.score !== null ? (
                  <div className="text-right">
                    <div className={`text-3xl font-bold px-4 py-2 rounded ${getGradeColor(activity.score)}`}>
                      {activity.score}%
                    </div>
                    <p className="text-xs text-slate-600 mt-1">{getLetterGrade(activity.score)} Grade</p>
                  </div>
                ) : (
                  <div className="text-right">
                    <div className="text-2xl font-bold text-yellow-600 px-4 py-2">
                      Pending
                    </div>
                    <p className="text-xs text-slate-600 mt-1">Awaiting grade</p>
                  </div>
                )}
              </div>

              {/* Feedback Section */}
              <div className="bg-slate-50 border border-slate-200 rounded p-4 mt-4">
                <p className="text-sm font-semibold text-slate-700 mb-2">Feedback:</p>
                <p className="text-slate-700 text-sm">{activity.feedback}</p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
