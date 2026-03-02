import { HashRouter, Routes, Route } from "react-router-dom";
import { Toaster } from "@/components/ui/sonner";
import { Layout } from "@/components/Layout";
import { Dashboard } from "@/pages/Dashboard";
import { AgentDetail } from "@/pages/AgentDetail";
import { NewAgent } from "@/pages/NewAgent";
import { Health } from "@/pages/Health";

export default function App() {
  return (
    <HashRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/agents/new" element={<NewAgent />} />
          <Route path="/agents/:id" element={<AgentDetail />} />
          <Route path="/health" element={<Health />} />
        </Route>
      </Routes>
      <Toaster />
    </HashRouter>
  );
}
