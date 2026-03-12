import { HashRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { AgentList } from "@/pages/AgentList";
import { AgentDetail } from "@/pages/AgentDetail";
import { AgentCreate } from "@/pages/AgentCreate";
import { Health } from "@/pages/Health";
import { Settings } from "@/pages/Settings";
import { Sessions } from "@/pages/Sessions";
import { CronJobs } from "@/pages/CronJobs";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/sessions" element={<Sessions />} />
          <Route path="/cron" element={<CronJobs />} />
          <Route path="/agents" element={<AgentList />} />
          <Route path="/agents/new" element={<AgentCreate />} />
          <Route path="/agents/:id" element={<AgentDetail />} />
          <Route path="/health" element={<Health />} />
          <Route path="/settings" element={<Settings />} />
        </Route>
      </Routes>
      <Toaster />
    </HashRouter>
  );
}
