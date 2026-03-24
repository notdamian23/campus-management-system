"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { Badge } from "@heroui/badge";
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
        color?: "default" | "primary" | "secondary" | "success" | "warning" | "danger";
    };
}

interface SidebarProps {
    navItems: NavItem[];
    enableMobileDrawer?: boolean;
    logoSize?: number;
    titleSize?: "sm" | "md" | "lg";
    showLogout?: boolean;
    showStudentAccountSwitch?: boolean;
    studentAccountHref?: string;
    studentAccountLabel?: string;
}

export function Sidebar({
    navItems,
    enableMobileDrawer = false,
    logoSize = 96,
    titleSize = "lg",
    showLogout = false,
    showStudentAccountSwitch = false,
    studentAccountHref = "/student",
    studentAccountLabel = "Student Account",
}: SidebarProps) {
    const pathname = usePathname();
    const router = useRouter();
    const [mobileOpen, setMobileOpen] = useState(false);

    // Close mobile drawer on route change
    useEffect(() => {
        setMobileOpen(false);
    }, [pathname]);

    const titleClasses = {
        sm: "text-3xl",
        md: "text-4xl",
        lg: "text-5xl"
    };

    const NavLinks = () => (
        <nav className="flex flex-col gap-2 px-4 mt-4">
            {navItems.map((item) => {
                const isActive = pathname === item.href;

                return (
                    <Link
                        key={item.href}
                        href={item.href}
                        className={`flex items-center gap-3 px-4 py-3 rounded-lg transition-all ${
                            isActive
                                ? "bg-primary-100 text-primary-600 font-semibold shadow-sm"
                                : "text-text-secondary hover:bg-bg-muted hover:text-text-primary"
                        }`}
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
                        {item.label}
                    </Link>
                );
            })}
        </nav>
    );

    const LogoSection = ({ size = logoSize }: { size?: number }) => (
        <div className="w-full flex justify-center mt-6 mb-4">
            <div className="flex flex-col items-center gap-3">
                <Image
                    src="/new campus-logo.jpg"
                    alt="Campus Logo"
                    width={size}
                    height={size}
                    className="rounded-full object-cover shadow-md"
                />
                <h2 className={`text-primary-500 font-black ${titleClasses[titleSize]}`}>
                    CAMPUS
                </h2>
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
                <div className="sticky top-0 z-40 flex items-center justify-between bg-bg-main border-b border-border shadow-sm px-4 py-3 lg:hidden">
                    <button
                        onClick={() => setMobileOpen(true)}
                        className="p-2 rounded-lg border hover:bg-gray-50"
                        aria-label="Open menu"
                    >
                        <FiMenu />
                    </button>

                    <div className="font-black text-primary-500 text-xl">CAMPUS</div>
                    <div className="w-8" />
                </div>
            )}

            {/* Desktop Sidebar */}
            <aside className={`${enableMobileDrawer ? 'hidden lg:block' : ''} w-64 bg-bg-main shadow-lg border-r border-border min-h-[100dvh] flex flex-col relative`}>
                <LogoSection />
                <NavLinks />
                <AccountSwitchSection />
                {showLogout && (
                    <div className="mt-auto px-4 pt-3 lg:absolute lg:bottom-2 lg:left-0 lg:right-0 lg:mt-0">
                        <LogoutButton className="w-full font-semibold" />
                    </div>
                )}
            </aside>

            {/* Mobile Drawer (only if enabled) */}
            {enableMobileDrawer && mobileOpen && (
                <div className="fixed inset-0 z-50 lg:hidden">
                    <button
                        className="absolute inset-0 bg-black/50"
                        onClick={() => setMobileOpen(false)}
                        aria-label="Close menu"
                    />

                    <aside className="absolute left-0 top-0 h-full w-72 bg-bg-main border-r border-border shadow-2xl flex flex-col">
                        <div className="flex items-center justify-between p-4 border-b border-border">
                            <div className="font-black text-primary-500 text-2xl">
                                CAMPUS
                            </div>
                            <button
                                onClick={() => setMobileOpen(false)}
                                className="p-2 rounded-lg border hover:bg-gray-50"
                                aria-label="Close menu"
                            >
                                <FiX />
                            </button>
                        </div>

                        <div className="flex-1 flex flex-col">
                            <div className="w-full flex justify-center mt-6 mb-2">
                                <Image
                                    src="/new campus-logo.jpg"
                                    alt="CAMPUS Logo"
                                    width={64}
                                    height={64}
                                    className="rounded-full object-cover shadow-md"
                                />
                            </div>

                            <NavLinks />
                            <AccountSwitchSection />

                            {showLogout && (
                                <div
                                    className="mt-auto px-4 pt-3"
                                    style={{ paddingBottom: "max(8px, env(safe-area-inset-bottom))" }}
                                >
                                    <LogoutButton className="w-full font-semibold" />
                                </div>
                            )}
                        </div>
                    </aside>
                </div>
            )}
        </>
    );
}
