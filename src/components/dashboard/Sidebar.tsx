"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LayoutDashboard, CalendarDays, PenSquare, Link2, Sparkles, BarChart2, Building2, ChevronsUpDown, Plus, Check, ClipboardList, LogOut, Wrench, Menu, X, FileCheck } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useState, useTransition, useEffect, useRef, createContext, useContext } from "react";
import { signOut, useSession } from "next-auth/react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";

// Context to allow other components to control mobile sidebar
const MobileSidebarContext = createContext<{
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
}>({ isOpen: false, setIsOpen: () => {} });

export function useMobileSidebar() {
  return useContext(MobileSidebarContext);
}

const NAV_LINKS = [
  { icon: LayoutDashboard, label: "Overview", href: "/dashboard" },
  { icon: CalendarDays, label: "Posts", href: "/dashboard/posts" },
  { icon: PenSquare, label: "New Post", href: "/dashboard/posts/new" },
  { icon: FileCheck, label: "Review", href: "/dashboard/review" },
  { icon: BarChart2, label: "Analytics", href: "/dashboard/analytics" },
  { icon: ClipboardList, label: "Content Queue", href: "/dashboard/briefs" },
  { icon: Link2, label: "Accounts", href: "/dashboard/accounts" },
] as const;

const BG_PALETTE = [
  "bg-violet-700",
  "bg-sky-700",
  "bg-emerald-700",
  "bg-amber-700",
  "bg-rose-700",
  "bg-cyan-700",
  "bg-indigo-700",
];

function businessInitials(name: string): string {
  return name
    .split(" ")
    .map((w) => w[0])
    .join("")
    .toUpperCase()
    .slice(0, 2);
}

function businessBg(name: string): string {
  return BG_PALETTE[name.charCodeAt(0) % BG_PALETTE.length];
}

interface Business {
  id: string;
  name: string;
}

interface SidebarProps {
  user: {
    name?: string | null;
    email?: string | null;
    image?: string | null;
  };
  businesses?: Business[];
  activeBusinessId?: string | null;
  showDevTools?: boolean;
}

export function Sidebar({ user, businesses = [], activeBusinessId, showDevTools = false }: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { update } = useSession();
  const [, startTransition] = useTransition();
  const [localActiveId, setLocalActiveId] = useState(activeBusinessId);
  const [mobileOpen, setMobileOpen] = useState(false);

  const activeBusiness = businesses.find((b) => b.id === localActiveId) ?? businesses[0];

  // Review badge count (client-side polling)
  const [reviewCount, setReviewCount] = useState(0);
  useEffect(() => {
    if (!localActiveId) return;
    let cancelled = false;
    async function fetchCount() {
      try {
        const res = await fetch("/api/posts/review-count");
        if (res.ok && !cancelled) {
          const data = await res.json();
          setReviewCount(data.count ?? 0);
        }
      } catch {
        // best-effort
      }
    }
    fetchCount();
    const id = setInterval(fetchCount, 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [localActiveId]);

  // Close mobile sidebar on route change
  const pathnameRef = useRef(pathname);
  useEffect(() => {
    if (pathnameRef.current !== pathname) {
      pathnameRef.current = pathname;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setMobileOpen(false);
    }
  }, [pathname]);

  const isActive = (href: string) => {
    if (href === "/dashboard") return pathname === "/dashboard";
    return pathname.startsWith(href);
  };

  const initials = user.name
    ? user.name.split(" ").map((n) => n[0]).join("").toUpperCase().slice(0, 2)
    : user.email?.[0]?.toUpperCase() ?? "?";

  async function handleSwitchBusiness(businessId: string) {
    setLocalActiveId(businessId); // optimistic
    try {
      await fetch("/api/businesses/switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ businessId }),
      });
      await update({ activeBusinessId: businessId });
      startTransition(() => {
        router.refresh();
      });
    } catch {
      setLocalActiveId(localActiveId); // revert on error
    }
  }

  const sidebarContent = (
    <>
      {/* Logo */}
      <div className="flex h-16 items-center gap-2.5 px-5 border-b border-zinc-800">
        <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-violet-600">
          <Sparkles className="h-4 w-4 text-white" />
        </div>
        <span className="font-semibold text-zinc-50 text-lg">AI Social</span>
        {/* Close button - mobile only */}
        <button
          onClick={() => setMobileOpen(false)}
          className="ml-auto md:hidden text-zinc-400 hover:text-zinc-200"
          aria-label="Close sidebar"
        >
          <X className="h-5 w-5" />
        </button>
      </div>

      {/* Business selector */}
      {businesses.length > 0 && (
        <div className="px-3 py-3 border-b border-zinc-800">
          <DropdownMenu>
            <DropdownMenuTrigger className="w-full flex items-center gap-2.5 rounded-lg px-2.5 py-2 hover:bg-zinc-800/60 transition-colors group">
              {activeBusiness ? (
                <>
                  <div
                    className={cn(
                      "flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white",
                      businessBg(activeBusiness.name)
                    )}
                  >
                    {businessInitials(activeBusiness.name)}
                  </div>
                  <span className="flex-1 min-w-0 text-left text-sm font-medium text-zinc-200 truncate">
                    {activeBusiness.name}
                  </span>
                </>
              ) : (
                <>
                  <Building2 className="h-4 w-4 text-zinc-500" />
                  <span className="flex-1 text-sm text-zinc-500">Select workspace</span>
                </>
              )}
              <ChevronsUpDown className="h-3.5 w-3.5 text-zinc-500 shrink-0" />
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="w-56 bg-zinc-800 border-zinc-700"
            >
              <DropdownMenuLabel className="text-xs text-zinc-500 font-normal">
                Workspaces
              </DropdownMenuLabel>
              {businesses.map((biz) => (
                <DropdownMenuItem
                  key={biz.id}
                  onClick={() => handleSwitchBusiness(biz.id)}
                  className="flex items-center gap-2.5 cursor-pointer focus:bg-zinc-700"
                >
                  <div
                    className={cn(
                      "flex h-6 w-6 shrink-0 items-center justify-center rounded text-xs font-bold text-white",
                      businessBg(biz.name)
                    )}
                  >
                    {businessInitials(biz.name)}
                  </div>
                  <span className="flex-1 text-sm text-zinc-200 truncate">{biz.name}</span>
                  {biz.id === localActiveId && (
                    <Check className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  )}
                </DropdownMenuItem>
              ))}
              <DropdownMenuSeparator className="bg-zinc-700" />
              <DropdownMenuItem asChild className="cursor-pointer focus:bg-zinc-700">
                <Link href="/dashboard/businesses/new" className="flex items-center gap-2 text-violet-400">
                  <Plus className="h-3.5 w-3.5" />
                  <span className="text-sm">New workspace</span>
                </Link>
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      )}

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
            {label === "Review" && reviewCount > 0 && (
              <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-violet-600 px-1.5 text-[10px] font-bold text-white">
                {reviewCount > 99 ? "99+" : reviewCount}
              </span>
            )}
          </Link>
        ))}
        {showDevTools && (
          <Link
            href="/dashboard/dev-tools"
            className={cn(
              "flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium transition-colors",
              isActive("/dashboard/dev-tools")
                ? "bg-zinc-800 text-zinc-50"
                : "text-amber-500/70 hover:bg-zinc-800/60 hover:text-amber-400"
            )}
          >
            <Wrench className="h-4 w-4 shrink-0" />
            Dev Tools
          </Link>
        )}
        {businesses.length === 0 && (
          <Link
            href="/dashboard/businesses/new"
            className="flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-medium text-violet-400 hover:bg-zinc-800/60 transition-colors"
          >
            <Plus className="h-4 w-4 shrink-0" />
            Create workspace
          </Link>
        )}
      </nav>

      {/* User */}
      <div className="border-t border-zinc-800 px-4 py-4 space-y-3">
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
        <button
          onClick={() => signOut({ callbackUrl: "/auth/signin" })}
          className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-sm font-medium text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200 transition-colors"
        >
          <LogOut className="h-4 w-4" />
          Sign out
        </button>
      </div>
    </>
  );

  return (
    <MobileSidebarContext.Provider value={{ isOpen: mobileOpen, setIsOpen: setMobileOpen }}>
      {/* Mobile header bar */}
      <div className="fixed top-0 left-0 right-0 z-40 flex h-14 items-center gap-3 border-b border-zinc-800 bg-zinc-900 px-4 md:hidden">
        <button
          onClick={() => setMobileOpen(true)}
          className="text-zinc-400 hover:text-zinc-200"
          aria-label="Open sidebar"
        >
          <Menu className="h-5 w-5" />
        </button>
        <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-violet-600">
          <Sparkles className="h-3.5 w-3.5 text-white" />
        </div>
        <span className="font-semibold text-zinc-50">AI Social</span>
      </div>

      {/* Mobile backdrop + sidebar */}
      {mobileOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/60 md:hidden"
          onClick={() => setMobileOpen(false)}
          aria-hidden="true"
        />
      )}
      <aside
        className={cn(
          "fixed inset-y-0 left-0 z-50 flex w-60 flex-col bg-zinc-900 border-r border-zinc-800 transition-transform duration-200 ease-in-out md:translate-x-0 md:z-40",
          mobileOpen ? "translate-x-0" : "-translate-x-full"
        )}
      >
        {sidebarContent}
      </aside>
    </MobileSidebarContext.Provider>
  );
}
