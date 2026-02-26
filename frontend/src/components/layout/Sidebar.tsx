import { NavLink } from "react-router-dom";
import { Globe, LayoutDashboard, ListTodo, Moon, Server, Settings, Sun } from "lucide-react";
import { useThemeStore } from "@/stores/themeStore";

const navItems = [
  { to: "/", icon: LayoutDashboard, label: "Dashboard" },
  { to: "/websites", icon: Globe, label: "Websites" },
  { to: "/tasks", icon: ListTodo, label: "Tasks" },
  { to: "/workers", icon: Server, label: "Workers" },
  { to: "/settings", icon: Settings, label: "Settings" },
];

export default function Sidebar() {
  const { theme, toggle } = useThemeStore();

  return (
    <aside className="flex h-screen w-56 flex-col border-r border-[var(--border)] bg-sidebar">
      <div className="flex h-14 items-center border-b border-[var(--border)] px-4">
        <span className="text-lg font-bold text-foreground">Link Machine</span>
      </div>
      <nav className="flex-1 space-y-1 p-3">
        {navItems.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.to === "/"}
            className={({ isActive }) =>
              `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors ${
                isActive
                  ? "bg-sidebar-active text-sidebar-active-text"
                  : "text-foreground-secondary hover:bg-sidebar-hover hover:text-foreground"
              }`
            }
          >
            <item.icon className="h-4 w-4" />
            {item.label}
          </NavLink>
        ))}
      </nav>
      <div className="border-t border-[var(--border)] p-3">
        <button
          onClick={toggle}
          className="flex w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-foreground-secondary transition-colors hover:bg-sidebar-hover hover:text-foreground"
        >
          {theme === "dark" ? (
            <Sun className="h-4 w-4" />
          ) : (
            <Moon className="h-4 w-4" />
          )}
          {theme === "dark" ? "Light Mode" : "Dark Mode"}
        </button>
      </div>
    </aside>
  );
}
