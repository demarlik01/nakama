import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import {
  LayoutDashboard,
  Radio,
  Clock,
  Bot,
  Activity,
  Settings2,
  ChevronDown,
  ChevronRight,
  Zap,
} from "lucide-react";
import { fetchHealth, type HealthInfo } from "@/lib/api";

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
}

interface NavCategory {
  key: string;
  label: string;
  items: NavItem[];
}

const categories: NavCategory[] = [
  {
    key: "control",
    label: "Control",
    items: [
      { to: "/", label: "Overview", icon: LayoutDashboard },
      { to: "/sessions", label: "Sessions", icon: Radio },
      { to: "/cron", label: "Cron Jobs", icon: Clock },
    ],
  },
  {
    key: "agent",
    label: "Agent",
    items: [{ to: "/agents", label: "Agents", icon: Bot }],
  },
  {
    key: "settings",
    label: "Settings",
    items: [
      { to: "/health", label: "Health", icon: Activity },
      { to: "/settings", label: "Settings", icon: Settings2 },
    ],
  },
];

function loadCollapsedState(): Record<string, boolean> {
  try {
    const raw = localStorage.getItem("sidebar-collapsed");
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        return parsed as Record<string, boolean>;
      }
    }
  } catch {
    // ignore corrupt or unavailable storage
  }
  return {};
}

function saveCollapsedState(state: Record<string, boolean>) {
  try {
    localStorage.setItem("sidebar-collapsed", JSON.stringify(state));
  } catch {
    // ignore quota or restricted storage
  }
}

export function Layout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsedState);
  const [health, setHealth] = useState<HealthInfo | null>(null);

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch(() => setHealth(null));
  }, []);

  const toggleCategory = (key: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [key]: !prev[key] };
      saveCollapsedState(next);
      return next;
    });
  };

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  const healthOk = health?.status === "ok";

  return (
    <div className="flex h-screen bg-background text-foreground">
      {/* Sidebar */}
      <aside className="w-56 shrink-0 border-r border-border bg-sidebar-background flex flex-col">
        {/* Header */}
        <div className="p-4">
          <div className="flex items-center gap-2 font-bold text-lg">
            <Zap className="h-5 w-5 text-yellow-500" />
            Agent for Work
          </div>
          <div className="flex items-center gap-2 mt-2">
            <Badge variant="outline" className="text-[10px] px-1.5 py-0">
              v0.1.0
            </Badge>
            <Badge
              variant={health ? (healthOk ? "default" : "destructive") : "outline"}
              className="text-[10px] px-1.5 py-0"
            >
              {health ? (healthOk ? "Healthy" : "Error") : "…"}
            </Badge>
          </div>
        </div>
        <Separator />

        {/* Navigation */}
        <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
          {categories.map((cat) => {
            const isCollapsed = !!collapsed[cat.key];
            return (
              <div key={cat.key}>
                <button
                  type="button"
                  onClick={() => toggleCategory(cat.key)}
                  aria-expanded={!isCollapsed}
                  aria-controls={`nav-${cat.key}`}
                  className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors rounded-md"
                >
                  <span>{cat.label}</span>
                  {isCollapsed ? (
                    <ChevronRight className="h-3.5 w-3.5" />
                  ) : (
                    <ChevronDown className="h-3.5 w-3.5" />
                  )}
                </button>
                {!isCollapsed && (
                  <div id={`nav-${cat.key}`} className="mt-0.5 space-y-0.5">
                    {cat.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.to);
                      return (
                        <Link
                          key={item.to}
                          to={item.to}
                          className={cn(
                            "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                            active
                              ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                              : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                          )}
                        >
                          <Icon className="h-4 w-4" />
                          {item.label}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* Main */}
      <main className="flex-1 min-h-0 flex flex-col overflow-hidden p-6">
        <div className="flex-1 min-h-0 overflow-auto">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
