"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { LayoutDashboard, CalendarDays, PenSquare, Link2, Sparkles, BarChart2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

const NAV_LINKS = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
  { icon: CalendarDays, label: "Posts", href: "/dashboard/posts" },
  { icon: PenSquare, label: "New Post", href: "/dashboard/posts/new" },
  { icon: BarChart2, label: "Analytics", href: "/dashboard/analytics" },
  { icon: Link2, label: "Accounts", href: "/dashboard/accounts" },
] as const;

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
}

export function Sidebar({ user }: SidebarProps) {
  const pathname = usePathname();

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email?.[0]?.toUpperCase() ?? "?";

  return (
    <aside className="fixed inset-y-0 left-0 z-40 flex w-60 flex-col bg-zinc-900 border-r border-zinc-800">
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-zinc-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-zinc-50 text-lg">AI Social</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 overflow-y-auto py-4 px-3 space-y-1">
        {NAV_LINKS.map(({ icon: Icon, label, href }) => (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive(href)
                ? "bg-zinc-800 text-zinc-50"
                : "text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            )}
          >
            <Icon className="h-4 w-4 shrink-0" />
            {label}
          </Link>
        ))}
      </nav>

      {/* User */}
      <div className="border-t border-zinc-800 px-4 py-4">
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            {user.image && <AvatarImage src={user.image} alt={user.name ?? "User"} />}
            <AvatarFallback className="bg-zinc-700 text-zinc-300 text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          <div className="flex-1 min-w-0">
            {user.name && (
              <p className="text-sm font-medium text-zinc-200 truncate">{user.name}</p>
            )}
            {user.email && (
              <p className="text-xs text-zinc-500 truncate">{user.email}</p>
            )}
          </div>
        </div>
      </div>
    </aside>
  );
}
