import { NextRequest, NextResponse } from "next/server";

const ROLE_HOME: Record<string, string> = {
    teacher: "/teacher",
    student: "/student",
    ec: "/ecmember",
};

function redirectToLogin(req: NextRequest) {
    const url = req.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
    return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
    const { pathname } = req.nextUrl;

    // Ignore Next internals + static assets
    if (
        pathname.startsWith("/_next") ||
        pathname.startsWith("/favicon.ico") ||
        pathname.startsWith("/assets") ||
        pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico)$/)
    ) {
        return NextResponse.next();
    }

    // ✅ Let /login always pass (no sidebar issues / no redirect loops)
    if (pathname === "/login") {
        return NextResponse.next();
    }

    // Cookies set on login
    const loggedIn = req.cookies.get("campus_logged_in")?.value === "1";
    const role = req.cookies.get("campus_role")?.value; // "student" | "teacher" | "ec"
    const mustChangePassword = req.cookies.get("campus_must_change")?.value === "1";

    const isProtected =
        pathname === "/change-password" ||
        pathname.startsWith("/teacher") ||
        pathname.startsWith("/student") ||
        pathname.startsWith("/ecmember");

    // 1) Not logged in → block protected routes
    if (isProtected && !loggedIn) {
        return redirectToLogin(req);
    }

    // 2) If must change password → force /change-password
    if (loggedIn && mustChangePassword && pathname !== "/change-password") {
        const url = req.nextUrl.clone();
        url.pathname = "/change-password";
        url.searchParams.set("next", pathname + req.nextUrl.search);
        return NextResponse.redirect(url);
    }

    // 3) Visiting /change-password but already changed → send home
    if (loggedIn && !mustChangePassword && pathname === "/change-password") {
        const url = req.nextUrl.clone();
        url.pathname = ROLE_HOME[role ?? ""] ?? "/";
        return NextResponse.redirect(url);
    }

    // 4) Role gating
    if (pathname.startsWith("/teacher") && role !== "teacher") {
        const url = req.nextUrl.clone();
        url.pathname = ROLE_HOME[role ?? ""] ?? "/";
        return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/student") && role !== "student") {
        const url = req.nextUrl.clone();
        url.pathname = ROLE_HOME[role ?? ""] ?? "/";
        return NextResponse.redirect(url);
    }

    if (pathname.startsWith("/ecmember") && role !== "ec") {
        const url = req.nextUrl.clone();
        url.pathname = ROLE_HOME[role ?? ""] ?? "/";
        return NextResponse.redirect(url);
    }

    return NextResponse.next();
}

export const config = {
    matcher: ["/((?!api).*)"],
};
