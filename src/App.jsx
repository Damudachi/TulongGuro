import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Landing from './pages/Landing';
import Login from './pages/Login';
import Register from './pages/Register';
import PlatformApprovals from './pages/PlatformApprovals';
import TeacherLayout from './layouts/TeacherLayout';
import StudentLayout from './layouts/StudentLayout';
import AdminLayout from './layouts/AdminLayout';
import UpdatePrompt from './components/UpdatePrompt';

// Admin Pages
import AdminTeachers from './pages/admin/Teachers';
import AdminTeacherDetail from './pages/admin/TeacherDetail';
import AdminSectionDetail from './pages/admin/SectionDetail';
import AdminCurriculum from './pages/admin/Curriculum';
import AdminRubrics from './pages/admin/Rubrics';
import AdminGrading from './pages/admin/Grading';
import AdminAnalytics from './pages/admin/Analytics';

// Teacher Pages
import TeacherDashboard from './pages/teacher/Dashboard';
import ClassHub from './pages/teacher/ClassHub';
import ActivityBuilder from './pages/teacher/ActivityBuilder';
import BatchUpload from './pages/teacher/BatchUpload';
import HITLWorkspace from './pages/teacher/HITLWorkspace';
import Settings from './pages/teacher/Settings';
import ManageSections from './pages/teacher/ManageSections';
import Gradebook from './pages/teacher/Gradebook';
import GradebookSection from './pages/teacher/GradebookSection';
import GradebookClass from './pages/teacher/GradebookClass';
import GradebookStudent from './pages/teacher/GradebookStudent';
import Analytics from './pages/teacher/Analytics';
import RubricManager from './pages/teacher/RubricManager';
import ScoreEntry from './pages/teacher/ScoreEntry';

// Student Pages
import StudentDashboard from './pages/student/Dashboard';
import OutputDetails from './pages/student/OutputDetails';
import Awards from './pages/student/Awards';
import Profile from './pages/student/Profile';
import SubmitWork from './pages/student/SubmitWork';
import ActivityDetails from './pages/student/ActivityDetails';
import StudentSettings from './pages/student/Settings';
import Subjects from './pages/student/Subjects';
import SubjectActivities from './pages/student/SubjectActivities';
import SubjectGradebook from './pages/student/SubjectGradebook';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Landing />} />
        <Route path="/login" element={<Login />} />
        <Route path="/register" element={<Register />} />
        {/* Operator-only, outside every school layout. Guarded server-side by
            PLATFORM_ADMIN_KEY — the route itself is just a form. */}
        <Route path="/platform/approvals" element={<PlatformApprovals />} />

        {/* Admin Routes */}
        <Route path="/admin" element={<AdminLayout />}>
          <Route index element={<Navigate to="teachers" />} />
          <Route path="teachers" element={<AdminTeachers />} />
          <Route path="teachers/:teacherId" element={<AdminTeacherDetail />} />
          <Route path="sections/:sectionId" element={<AdminSectionDetail />} />
          <Route path="curriculum" element={<AdminCurriculum />} />
          <Route path="rubrics" element={<AdminRubrics />} />
          <Route path="grading" element={<AdminGrading />} />
          <Route path="analytics" element={<AdminAnalytics />} />
        </Route>

        {/* Teacher Routes */}
        <Route path="/teacher" element={<TeacherLayout />}>
          <Route index element={<Navigate to="dashboard" />} />
          <Route path="dashboard" element={<TeacherDashboard />} />
          <Route path="class/:classId" element={<ClassHub />} />
          <Route path="activity/new" element={<ActivityBuilder />} />
          <Route path="activity/edit/:activityId" element={<ActivityBuilder />} />
          <Route path="batch-upload" element={<BatchUpload />} />
          <Route path="scores" element={<ScoreEntry />} />
          <Route path="review/:submissionId" element={<HITLWorkspace />} />
          <Route path="sections" element={<ManageSections />} />
          <Route path="gradebook" >
            <Route index element={<Gradebook />} />
            <Route path="section/:sectionId" element={<GradebookSection />} />
            <Route path="class/:classId" element={<GradebookClass />} />
            <Route path="student/:studentId" element={<GradebookStudent />} />
          </Route>
          <Route path="analytics" element={<Analytics />} />
          <Route path="rubrics" element={<RubricManager />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Student Routes */}
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<Navigate to="dashboard" />} />
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="output/:outputId" element={<OutputDetails />} />
          <Route path="subjects" element={<Subjects />} />
          <Route path="subjects/activities" element={<SubjectActivities />} />
          <Route path="subjects/gradebook" element={<SubjectGradebook />} />
          <Route path="awards" element={<Awards />} />
          <Route path="profile" element={<Profile />} />
          <Route path="submit" element={<SubmitWork />} />
          <Route path="activity/:activityId" element={<ActivityDetails />} />
          <Route path="settings" element={<StudentSettings />} />
        </Route>
      </Routes>
      <UpdatePrompt />
    </Router>
  );
}

export default App;
