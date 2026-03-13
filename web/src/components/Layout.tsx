import { Link, Outlet, useLocation } from "react-router-dom";
import { useEffect, useState, useCallback } from "react";
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
  Minus,
  Plus,
  Zap,
  PanelLeftClose,
  PanelLeftOpen,
  Sun,
  Moon,
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

function loadSidebarOpen(): boolean {
  try {
    const raw = localStorage.getItem("sidebar-open");
    if (raw !== null) return raw === "true";
  } catch {
    // ignore
  }
  return true;
}

function saveSidebarOpen(open: boolean) {
  try {
    localStorage.setItem("sidebar-open", String(open));
  } catch {
    // ignore
  }
}

function loadTheme(): "dark" | "light" {
  try {
    const raw = localStorage.getItem("theme");
    if (raw === "light" || raw === "dark") return raw;
  } catch {
    // ignore
  }
  return "dark";
}

function applyTheme(theme: "dark" | "light") {
  if (theme === "dark") {
    document.documentElement.classList.add("dark");
  } else {
    document.documentElement.classList.remove("dark");
  }
  try {
    localStorage.setItem("theme", theme);
  } catch {
    // ignore
  }
}

export function Layout() {
  const location = useLocation();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(loadCollapsedState);
  const [health, setHealth] = useState<HealthInfo | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(loadSidebarOpen);
  const [theme, setTheme] = useState<"dark" | "light">(loadTheme);

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

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

  const toggleSidebar = useCallback(() => {
    setSidebarOpen((prev) => {
      const next = !prev;
      saveSidebarOpen(next);
      return next;
    });
  }, []);

  const toggleTheme = useCallback(() => {
    setTheme((prev) => (prev === "dark" ? "light" : "dark"));
  }, []);

  const isActive = (to: string) => {
    if (to === "/") return location.pathname === "/";
    return location.pathname.startsWith(to);
  };

  const healthOk = health?.status === "ok";

  return (
    <div className="flex h-screen flex-col bg-background text-foreground">
      {/* Top Header Bar */}
      <header className="h-12 shrink-0 border-b border-border bg-sidebar-background flex items-center px-3 gap-3">
        {/* Left: sidebar toggle + logo */}
        <button
          type="button"
          onClick={toggleSidebar}
          className="p-1.5 rounded-md hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground transition-colors"
          title={sidebarOpen ? "Collapse sidebar" : "Expand sidebar"}
        >
          {sidebarOpen ? (
            <PanelLeftClose className="h-4 w-4" />
          ) : (
            <PanelLeftOpen className="h-4 w-4" />
          )}
        </button>
        <div className="flex items-center gap-2 font-bold text-sm">
          <Zap className="h-4 w-4 text-yellow-500" />
          <span>Agent for Work</span>
        </div>

        {/* Right: version + health + theme toggle */}
        <div className="ml-auto flex items-center gap-2">
          <Badge variant="outline" className="text-[10px] px-1.5 py-0">
            v0.1.0
          </Badge>
          <Badge
            variant={health ? (healthOk ? "default" : "destructive") : "outline"}
            className="text-[10px] px-1.5 py-0"
          >
            {health ? (healthOk ? "Healthy" : "Error") : "…"}
          </Badge>
          <button
            type="button"
            onClick={toggleTheme}
            className="p-1.5 rounded-md hover:bg-sidebar-accent/50 text-muted-foreground hover:text-foreground transition-colors"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? (
              <Sun className="h-4 w-4" />
            ) : (
              <Moon className="h-4 w-4" />
            )}
          </button>
        </div>
      </header>

      {/* Body: Sidebar + Main */}
      <div className="flex-1 min-h-0 flex">
        {/* Sidebar */}
        <aside
          className={cn(
            "shrink-0 border-r border-border bg-sidebar-background flex flex-col transition-[width] duration-200",
            sidebarOpen ? "w-56" : "w-14"
          )}
        >
          {/* Navigation */}
          <nav className="flex-1 p-2 space-y-1 overflow-y-auto">
            {categories.map((cat) => {
              const isCollapsed = !!collapsed[cat.key];
              return (
                <div key={cat.key}>
                  {/* Category header: hidden when sidebar is collapsed */}
                  {sidebarOpen && (
                    <button
                      type="button"
                      onClick={() => toggleCategory(cat.key)}
                      aria-expanded={!isCollapsed}
                      aria-controls={`nav-${cat.key}`}
                      className="flex items-center justify-between w-full px-3 py-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors rounded-md"
                    >
                      <span>{cat.label}</span>
                      {isCollapsed ? (
                        <Plus className="h-3 w-3" />
                      ) : (
                        <Minus className="h-3 w-3" />
                      )}
                    </button>
                  )}
                  {/* Show items: always show when sidebar collapsed, respect category collapse when open */}
                  {(!sidebarOpen || !isCollapsed) && (
                    <div
                      id={`nav-${cat.key}`}
                      className={cn(sidebarOpen && "mt-0.5 space-y-0.5")}
                    >
                      {cat.items.map((item) => {
                        const Icon = item.icon;
                        const active = isActive(item.to);
                        return (
                          <Link
                            key={item.to}
                            to={item.to}
                            title={sidebarOpen ? undefined : item.label}
                            className={cn(
                              "flex items-center rounded-md text-sm transition-colors",
                              sidebarOpen
                                ? "gap-2 px-3 py-2"
                                : "justify-center px-2 py-2",
                              active
                                ? "bg-sidebar-accent text-sidebar-accent-foreground font-medium"
                                : "text-sidebar-foreground hover:bg-sidebar-accent/50"
                            )}
                          >
                            <Icon className="h-4 w-4 shrink-0" />
                            {sidebarOpen && item.label}
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
        <main className="flex-1 min-h-0 flex flex-col p-6">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
