"use client";

import { useCallback, useEffect, useState } from "react";
import clsx from "clsx";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@heroui/badge";
import { Button } from "@heroui/button";
import {
  Drawer,
  DrawerBody,
  DrawerContent,
  DrawerHeader,
} from "@heroui/drawer";
import { ScrollShadow } from "@heroui/scroll-shadow";
import { Switch } from "@heroui/switch";
import Icon from "@mdi/react";
import { mdiAccountSwitch } from "@mdi/js";
import { FiMenu, FiX } from "react-icons/fi";
import LogoutButton from "@/components/LogoutButton";

export interface NavItem {
  href: string;
  icon: string;
  label: string;
  badge?: {
    content: string;
    color?:
      | "default"
      | "primary"
      | "secondary"
      | "success"
      | "warning"
      | "danger";
  };
}

function normalizeSidebarPath(path: string) {
  if (!path) return "/";
  if (path === "/") return path;
  return path.replace(/\/+$/, "") || "/";
}

function doesNavItemMatchPath(pathname: string, href: string) {
  const normalizedPathname = normalizeSidebarPath(pathname);
  const normalizedHref = normalizeSidebarPath(href);

  return (
    normalizedPathname === normalizedHref ||
    normalizedPathname.startsWith(`${normalizedHref}/`)
  );
}

function getActiveNavItem(navItems: NavItem[], pathname: string) {
  const matches = navItems.filter((item) =>
    doesNavItemMatchPath(pathname, item.href),
  );

  if (matches.length === 0) {
    return navItems[0];
  }

  return matches.sort((left, right) => right.href.length - left.href.length)[0];
}

interface SidebarProps {
  navItems: NavItem[];
  enableMobileDrawer?: boolean;
  logoSize?: number;
  titleSize?: "sm" | "md" | "lg";
  contextLabel?: string;
  showLogout?: boolean;
  showStudentAccountSwitch?: boolean;
  studentAccountHref?: string;
  studentAccountLabel?: string;
}

export function Sidebar({
  navItems,
  enableMobileDrawer = false,
  logoSize = 188,
  contextLabel,
  showLogout = false,
  showStudentAccountSwitch = false,
  studentAccountHref = "/student",
  studentAccountLabel = "Student Account",
}: SidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const [isMobileSidebarOpen, setIsMobileSidebarOpen] = useState(false);

  const openMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(true);
  }, []);

  const closeMobileSidebar = useCallback(() => {
    setIsMobileSidebarOpen(false);
  }, []);

  const handleMobileDrawerOpenChange = useCallback((open: boolean) => {
    // Keep the mobile drawer fully controlled. It may close from overlay clicks
    // or the escape key, but it should never auto-open unless the user taps the
    // menu button.
    if (!open) {
      closeMobileSidebar();
    }
  }, [closeMobileSidebar]);

  // Close mobile drawer on route change
  useEffect(() => {
    closeMobileSidebar();
  }, [closeMobileSidebar, pathname]);

  useEffect(() => {
    if (!enableMobileDrawer) return;

    const mediaQuery = window.matchMedia("(min-width: 1024px)");
    const handleBreakpointChange = (
      event: MediaQueryList | MediaQueryListEvent,
    ) => {
      if (event.matches) {
        closeMobileSidebar();
      }
    };

    handleBreakpointChange(mediaQuery);

    if (typeof mediaQuery.addEventListener === "function") {
      mediaQuery.addEventListener("change", handleBreakpointChange);
      return () =>
        mediaQuery.removeEventListener("change", handleBreakpointChange);
    }

    mediaQuery.addListener(handleBreakpointChange);
    return () => mediaQuery.removeListener(handleBreakpointChange);
  }, [closeMobileSidebar, enableMobileDrawer]);

  const activeItem = getActiveNavItem(navItems, pathname);

  const handleRefreshPage = () => {
    closeMobileSidebar();
    window.location.reload();
  };

  const NavLinks = () => (
    <nav className="mt-4 flex flex-col gap-1.5 px-3">
      {navItems.map((item) => {
        const isActive = activeItem?.href === item.href;

        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={() => {
              if (enableMobileDrawer) {
                closeMobileSidebar();
              }
            }}
            className={clsx(
              "group flex items-center gap-3 rounded-2xl px-3 py-3.5 transition-all",
              isActive
                ? "bg-primary-50 text-primary-700 shadow-sm ring-1 ring-primary-100"
                : "text-campus-text-secondary hover:bg-white hover:text-campus-text-primary",
            )}
          >
            <span
              className={clsx(
                "flex h-10 w-10 shrink-0 items-center justify-center rounded-2xl transition-colors",
                isActive
                  ? "bg-primary-100 text-primary-700"
                  : "bg-slate-100 text-campus-text-secondary group-hover:bg-slate-200 group-hover:text-campus-text-primary",
              )}
            >
              {item.badge ? (
                <Badge
                  content={item.badge.content}
                  color={item.badge.color || "danger"}
                  size="sm"
                  placement="top-right"
                >
                  <span className="material-icons">{item.icon}</span>
                </Badge>
              ) : (
                <span className="material-icons">{item.icon}</span>
              )}
            </span>

            <div className="min-w-0 flex-1">
              <span className="block truncate text-sm font-semibold">
                {item.label}
              </span>
            </div>

            {isActive ? (
              <span className="h-2.5 w-2.5 rounded-full bg-primary-500" />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );

  const LogoButton = ({
    width,
    height,
    className,
  }: {
    width: number;
    height: number;
    className: string;
  }) => {
    const logoSrc = pathname.startsWith('/ecmember') ? '/campus-ecview-logo.png' : '/new campus-logo.jpg';
    return (
      <button
        type="button"
        onClick={handleRefreshPage}
        aria-label="Refresh page"
        title="Refresh page"
        className="rounded-[28px] transition-transform hover:scale-[1.01] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500/40"
      >
        <Image
          src={logoSrc}
          alt="Campus Logo"
          width={width}
          height={height}
          className={clsx(
            "cursor-pointer h-auto max-w-full object-contain drop-shadow-md",
            className,
          )}
        />
      </button>
    );
  };

  const LogoSection = ({ size = logoSize }: { size?: number }) => (
    <div className="mb-4 mt-6 flex w-full justify-center px-4">
      <div className="flex flex-col items-center gap-4 text-center">
        <LogoButton
          width={size}
          height={Math.round(size * 0.52)}
          className="w-auto"
        />
        {contextLabel ? (
          <p className="text-xs font-semibold uppercase tracking-[0.2em] text-campus-text-secondary">
            {contextLabel}
          </p>
        ) : null}
      </div>
    </div>
  );

  const AccountSwitchSection = () => {
    if (!showStudentAccountSwitch) return null;

    return (
      <div className="px-4 mt-2">
        <div className="flex items-center justify-between gap-3 px-4 py-3 rounded-lg border border-border bg-bg-main">
          <div className="flex items-center gap-3 min-w-0">
            <Icon
              path={mdiAccountSwitch}
              size={0.95}
              className="text-text-secondary shrink-0"
              aria-hidden="true"
            />
            <span className="text-sm font-medium text-text-primary truncate">
              {studentAccountLabel}
            </span>
          </div>

          <Switch
            size="sm"
            color="primary"
            aria-label={`Switch to ${studentAccountLabel}`}
            onValueChange={(isSelected) => {
              if (!isSelected) return;
              closeMobileSidebar();
              router.push(studentAccountHref);
            }}
          />
        </div>
      </div>
    );
  };

  return (
    <>
      {/* Mobile Top Bar (only if drawer enabled) */}
      {enableMobileDrawer && (
        <div className="sticky top-0 z-40 flex items-center gap-3 border-b border-border/70 bg-white/95 px-3 py-3 shadow-[0_8px_20px_rgba(15,23,42,0.06)] backdrop-blur lg:hidden">
          <Button
            isIconOnly
            variant="bordered"
            onPress={openMobileSidebar}
            aria-label="Open menu"
            className="border-border bg-bg-main text-campus-text-primary"
          >
            <FiMenu className="text-lg" />
          </Button>

          <div className="min-w-0 flex-1">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.18em] text-campus-text-secondary sm:text-[11px]">
              {contextLabel || "Campus Portal"}
            </p>
            <p className="mt-0.5 truncate text-base font-semibold leading-tight text-campus-text-primary">
              {activeItem?.label || "Workspace"}
            </p>
          </div>

          <LogoButton
            width={70}
            height={36}
            className="w-[70px] shrink-0 drop-shadow-sm"
          />
        </div>
      )}

      {/* Desktop Sidebar */}
      <aside
        className={clsx(
          enableMobileDrawer ? "hidden lg:flex" : "flex",
          "relative min-h-[100dvh] w-[18.5rem] flex-col border-r border-border/70 bg-white/90 shadow-lg backdrop-blur",
        )}
      >
        <LogoSection />
        <ScrollShadow hideScrollBar className="min-h-0 flex-1">
          <NavLinks />
          <AccountSwitchSection />
        </ScrollShadow>
        {showLogout && (
          <div className="mt-auto border-t border-border/70 p-4">
            <div className="rounded-[22px] bg-slate-50/80 p-3">
              <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-campus-text-secondary">
                Account
              </p>
              <LogoutButton className="w-full font-semibold" />
            </div>
          </div>
        )}
      </aside>

      {/* Mobile Drawer (only if enabled) */}
      {enableMobileDrawer && (
        <Drawer
          isOpen={isMobileSidebarOpen}
          onOpenChange={handleMobileDrawerOpenChange}
          placement="left"
          hideCloseButton
          className="lg:hidden"
        >
          <DrawerContent className="max-w-80">
            {(onClose) => (
              <>
                <DrawerHeader className="border-b border-border/70 px-4 py-4">
                  <div className="flex w-full items-center gap-3">
                    <LogoButton
                      width={96}
                      height={50}
                      className="w-[96px] shrink-0 drop-shadow-sm"
                    />

                    <div className="min-w-0 flex-1">
                      <p className="max-w-[116px] whitespace-normal text-xs font-semibold uppercase tracking-[0.18em] leading-tight text-campus-text-secondary">
                        {contextLabel || "Campus Portal"}
                      </p>
                    </div>

                    <Button
                      isIconOnly
                      variant="light"
                      onPress={() => {
                        closeMobileSidebar();
                        onClose();
                      }}
                      aria-label="Close menu"
                      className="shrink-0 text-campus-text-primary"
                    >
                      <FiX className="text-lg" />
                    </Button>
                  </div>
                </DrawerHeader>
                <DrawerBody className="p-0">
                  <div
                    className="flex h-full flex-col"
                    style={{
                      paddingBottom: "max(8px, env(safe-area-inset-bottom))",
                    }}
                  >
                    <ScrollShadow hideScrollBar className="min-h-0 flex-1">
                      <NavLinks />
                      <AccountSwitchSection />
                    </ScrollShadow>

                    {showLogout ? (
                      <div className="mt-auto border-t border-border/70 px-4 pb-4 pt-3">
                        <div className="rounded-[22px] bg-slate-50/80 p-3">
                          <p className="mb-3 text-xs font-semibold uppercase tracking-[0.18em] text-campus-text-secondary">
                            Account
                          </p>
                          <LogoutButton className="w-full font-semibold" />
                        </div>
                      </div>
                    ) : null}
                  </div>
                </DrawerBody>
              </>
            )}
          </DrawerContent>
        </Drawer>
      )}
    </>
  );
}
