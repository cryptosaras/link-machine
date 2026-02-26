import { LogOut } from "lucide-react";
import { useAuthStore } from "@/stores/authStore";
import { Button } from "@/components/ui/button";

export default function Header() {
  const { user, logout } = useAuthStore();

  return (
    <header className="flex h-14 items-center justify-between border-b border-gray-800 bg-gray-900 px-6">
      <div />
      <div className="flex items-center gap-4">
        <span className="text-sm text-gray-400">{user?.username}</span>
        <Button variant="ghost" size="icon" onClick={logout} title="Sign out">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}
