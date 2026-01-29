import * as React from "react";
import { Link, NavLink } from "react-router-dom";
import { clsx } from "clsx";
import { ChevronLeft, Menu, X } from "lucide-react";
import { useIsMobile } from "./use-mobile";
import { Tooltip } from "./tooltip";

// Soft spring easing for smooth animations
const softSpringEasing = "cubic-bezier(0.25, 1.1, 0.4, 1)";

interface SidebarContextProps {
  isCollapsed: boolean;
  setIsCollapsed: (collapsed: boolean) => void;
  isMobileOpen: boolean;
  setIsMobileOpen: (open: boolean) => void;
  isMobile: boolean;
}

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

export function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error("useSidebar must be used within a SidebarProvider");
  }
  return context;
}

interface SidebarProviderProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export function SidebarProvider({ children, defaultCollapsed = false }: SidebarProviderProps) {
  const isMobile = useIsMobile();
  const [isCollapsed, setIsCollapsed] = React.useState(defaultCollapsed);
  const [isMobileOpen, setIsMobileOpen] = React.useState(false);

  // Close mobile sidebar when screen gets larger
  React.useEffect(() => {
    if (!isMobile) {
      setIsMobileOpen(false);
    }
  }, [isMobile]);

  return (
    <SidebarContext.Provider
      value={{ isCollapsed, setIsCollapsed, isMobileOpen, setIsMobileOpen, isMobile }}
    >
      {children}
    </SidebarContext.Provider>
  );
}

interface SidebarProps {
  children: React.ReactNode;
  className?: string;
}

export function Sidebar({ children, className }: SidebarProps) {
  const { isCollapsed, isMobileOpen, setIsMobileOpen, isMobile } = useSidebar();

  // Mobile overlay
  if (isMobile) {
    return (
      <>
        {/* Mobile overlay */}
        {isMobileOpen && (
          <div
            className="fixed inset-0 bg-black/50 z-40 md:hidden"
            onClick={() => setIsMobileOpen(false)}
          />
        )}
        {/* Mobile sidebar */}
        <aside
          className={clsx(
            "fixed inset-y-0 left-0 z-50 flex flex-col bg-[#0A0A0A] transition-transform duration-300 ease-out md:hidden",
            isMobileOpen ? "translate-x-0" : "-translate-x-full",
            "w-72"
          )}
        >
          {children}
        </aside>
      </>
    );
  }

  // Desktop sidebar
  return (
    <aside
      className={clsx(
        "flex flex-col bg-[#0A0A0A] h-screen transition-all duration-500",
        isCollapsed ? "w-16" : "w-64",
        className
      )}
      style={{ transitionTimingFunction: softSpringEasing }}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isCollapsed } = useSidebar();

  return (
    <div
      className={clsx(
        "flex items-center border-b border-neutral-800 transition-all duration-500",
        isCollapsed ? "h-16 justify-center px-2" : "h-16 px-4",
        className
      )}
      style={{ transitionTimingFunction: softSpringEasing }}
    >
      {children}
    </div>
  );
}

export function SidebarContent({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("flex-1 overflow-y-auto py-4", className)}>
      {children}
    </div>
  );
}

export function SidebarFooter({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("border-t border-neutral-800 p-3", className)}>
      {children}
    </div>
  );
}

export function SidebarGroup({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={clsx("mb-4", className)}>
      {children}
    </div>
  );
}

export function SidebarGroupLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  const { isCollapsed } = useSidebar();

  return (
    <div
      className={clsx(
        "px-4 py-2 text-xs font-semibold text-neutral-400 uppercase tracking-wider transition-all duration-500 overflow-hidden",
        isCollapsed ? "opacity-0 h-0 py-0" : "opacity-100",
        className
      )}
      style={{ transitionTimingFunction: softSpringEasing }}
    >
      {children}
    </div>
  );
}

interface SidebarItemProps {
  icon: React.ElementType;
  label: string;
  href: string;
  end?: boolean;
  onClick?: () => void;
}

export function SidebarItem({ icon: Icon, label, href, end, onClick }: SidebarItemProps) {
  const { isCollapsed, setIsMobileOpen, isMobile } = useSidebar();

  const handleClick = () => {
    if (isMobile) {
      setIsMobileOpen(false);
    }
    onClick?.();
  };

  const content = (
    <NavLink
      to={href}
      end={end}
      onClick={handleClick}
      className={({ isActive }) =>
        clsx(
          "flex items-center rounded-lg transition-all duration-300",
          isCollapsed ? "mx-2 p-3 justify-center" : "mx-2 px-3 py-2.5",
          isActive
            ? "bg-neutral-800 text-white"
            : "text-neutral-400 hover:bg-neutral-900 hover:text-white"
        )
      }
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span
        className={clsx(
          "ml-3 text-sm font-medium transition-all duration-500 whitespace-nowrap overflow-hidden",
          isCollapsed ? "opacity-0 w-0 ml-0" : "opacity-100"
        )}
        style={{ transitionTimingFunction: softSpringEasing }}
      >
        {label}
      </span>
    </NavLink>
  );

  if (isCollapsed) {
    return (
      <Tooltip content={label} side="right">
        {content}
      </Tooltip>
    );
  }

  return content;
}

interface SidebarLinkProps {
  icon: React.ElementType;
  label: string;
  href: string;
  onClick?: () => void;
}

export function SidebarLink({ icon: Icon, label, href, onClick }: SidebarLinkProps) {
  const { isCollapsed, setIsMobileOpen, isMobile } = useSidebar();

  const handleClick = () => {
    if (isMobile) {
      setIsMobileOpen(false);
    }
    onClick?.();
  };

  const content = (
    <Link
      to={href}
      onClick={handleClick}
      className={clsx(
        "flex items-center rounded-lg transition-all duration-300",
        isCollapsed ? "mx-2 p-3 justify-center" : "mx-2 px-3 py-2.5",
        "text-neutral-400 hover:bg-neutral-900 hover:text-white"
      )}
    >
      <Icon className="h-5 w-5 flex-shrink-0" />
      <span
        className={clsx(
          "ml-3 text-sm font-medium transition-all duration-500 whitespace-nowrap overflow-hidden",
          isCollapsed ? "opacity-0 w-0 ml-0" : "opacity-100"
        )}
        style={{ transitionTimingFunction: softSpringEasing }}
      >
        {label}
      </span>
    </Link>
  );

  if (isCollapsed) {
    return (
      <Tooltip content={label} side="right">
        {content}
      </Tooltip>
    );
  }

  return content;
}

export function SidebarToggle() {
  const { isCollapsed, setIsCollapsed } = useSidebar();

  return (
    <button
      onClick={() => setIsCollapsed(!isCollapsed)}
      className="flex items-center justify-center p-2 rounded-lg text-neutral-400 hover:bg-neutral-900 hover:text-white transition-colors"
      title={isCollapsed ? "Expand sidebar" : "Collapse sidebar"}
    >
      <ChevronLeft
        className={clsx(
          "h-5 w-5 transition-transform duration-500",
          isCollapsed && "rotate-180"
        )}
        style={{ transitionTimingFunction: softSpringEasing }}
      />
    </button>
  );
}

export function SidebarMobileTrigger() {
  const { isMobileOpen, setIsMobileOpen, isMobile } = useSidebar();

  if (!isMobile) return null;

  return (
    <button
      onClick={() => setIsMobileOpen(!isMobileOpen)}
      className="fixed top-4 left-4 z-30 p-2 rounded-lg bg-white border border-gray-200 shadow-sm md:hidden"
    >
      {isMobileOpen ? (
        <X className="h-5 w-5 text-gray-700" />
      ) : (
        <Menu className="h-5 w-5 text-gray-700" />
      )}
    </button>
  );
}

export function SidebarSeparator() {
  const { isCollapsed } = useSidebar();

  return (
    <div
      className={clsx(
        "border-t border-neutral-800 my-4 transition-all duration-500",
        isCollapsed ? "mx-2" : "mx-4"
      )}
      style={{ transitionTimingFunction: softSpringEasing }}
    />
  );
}
