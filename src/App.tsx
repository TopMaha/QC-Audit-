import { Navigate, Route, Routes } from 'react-router-dom';
import { AppShell } from '@/components/AppShell';
import AdminGate from '@/pages/AdminGate';
import Dashboard from '@/pages/Dashboard';
import Home from '@/pages/Home';
import Inspect from '@/pages/Inspect';
import IssueDetail from '@/pages/IssueDetail';
import Issues from '@/pages/Issues';
import MyWork from '@/pages/MyWork';
import Report from '@/pages/Report';
import Rounds from '@/pages/Rounds';
import Settings from '@/pages/Settings';
import VsmBoard from '@/pages/VsmBoard';

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Home />} />
      <Route path="/admin" element={<AdminGate />} />

      <Route element={<AppShell />}>
        <Route path="/mywork" element={<MyWork />} />
        <Route path="/inspect" element={<Inspect />} />
        <Route path="/issues" element={<Issues />} />
        <Route path="/issues/new" element={<Inspect adhoc />} />
        <Route path="/issues/:issueId" element={<IssueDetail />} />
        <Route path="/rounds" element={<Rounds />} />
        <Route path="/dashboard" element={<Dashboard />} />
        <Route path="/vsm" element={<VsmBoard />} />
        <Route path="/admin/settings" element={<Settings />} />
        <Route path="/admin/report" element={<Report />} />
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
