import { BrowserRouter as Router, Routes, Route, Navigate } from 'react-router-dom';
import Login from './pages/Login';
import Register from './pages/Register';
import TeacherLayout from './layouts/TeacherLayout';
import StudentLayout from './layouts/StudentLayout';

// Teacher Pages
import TeacherDashboard from './pages/teacher/Dashboard';
import ClassHub from './pages/teacher/ClassHub';
import ActivityBuilder from './pages/teacher/ActivityBuilder';
import BatchUpload from './pages/teacher/BatchUpload';
import HITLWorkspace from './pages/teacher/HITLWorkspace';
import Settings from './pages/teacher/Settings';
import ManageSections from './pages/teacher/ManageSections';
import Gradebook from './pages/teacher/Gradebook';
import Analytics from './pages/teacher/Analytics';
import RubricManager from './pages/teacher/RubricManager';

// Student Pages
import StudentDashboard from './pages/student/Dashboard';
import OutputDetails from './pages/student/OutputDetails';
import Awards from './pages/student/Awards';
import Profile from './pages/student/Profile';
import SubmitWork from './pages/student/SubmitWork';

function App() {
  return (
    <Router>
      <Routes>
        <Route path="/" element={<Login />} />
        <Route path="/register" element={<Register />} />

        {/* Teacher Routes */}
        <Route path="/teacher" element={<TeacherLayout />}>
          <Route index element={<Navigate to="dashboard" />} />
          <Route path="dashboard" element={<TeacherDashboard />} />
          <Route path="class/:classId" element={<ClassHub />} />
          <Route path="activity/new" element={<ActivityBuilder />} />
          <Route path="batch-upload" element={<BatchUpload />} />
          <Route path="review/:submissionId" element={<HITLWorkspace />} />
          <Route path="sections" element={<ManageSections />} />
          <Route path="gradebook" element={<Gradebook />} />
          <Route path="analytics" element={<Analytics />} />
          <Route path="rubrics" element={<RubricManager />} />
          <Route path="settings" element={<Settings />} />
        </Route>

        {/* Student Routes */}
        <Route path="/student" element={<StudentLayout />}>
          <Route index element={<Navigate to="dashboard" />} />
          <Route path="dashboard" element={<StudentDashboard />} />
          <Route path="output/:outputId" element={<OutputDetails />} />
          <Route path="awards" element={<Awards />} />
          <Route path="profile" element={<Profile />} />
          <Route path="submit" element={<SubmitWork />} />
        </Route>
      </Routes>
    </Router>
  );
}

export default App;
