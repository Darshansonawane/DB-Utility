import { Navigate, Route, Routes } from 'react-router-dom';
import AppLayout from './layouts/AppLayout';
import Dashboard from './pages/Dashboard';
import Connections from './pages/Connections';
import SavedQueries from './pages/SavedQueries';
import WorkflowManager from './pages/WorkflowManager';
import ApiAutomation from './pages/ApiAutomation';
import InfoHub from './pages/InfoHub';
import History from './pages/History';
import Settings from './pages/Settings';

export default function App() {
  return (
    <Routes>
      <Route element={<AppLayout />}>
        <Route index element={<Dashboard />} />
        <Route path="connections" element={<Connections />} />
        <Route path="queries" element={<SavedQueries />} />
        <Route path="workflows" element={<WorkflowManager />} />
        <Route path="api-automation" element={<ApiAutomation />} />
        <Route path="history" element={<History />} />
        <Route path="settings" element={<Settings />} />
        <Route path="info" element={<InfoHub />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Route>
    </Routes>
  );
}
