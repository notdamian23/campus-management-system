import { NextRequest, NextResponse } from "next/server";

const ROLE_HOME: Record<string, string> = {
  teacher: "/teacher",
  student: "/student",
  ec: "/ecmember",
  ecmember: "/ecmember",
  admin: "/admin",
};

function redirectToLogin(req: NextRequest) {
  const url = req.nextUrl.clone();
  url.pathname = "/login";
  url.searchParams.set("next", req.nextUrl.pathname + req.nextUrl.search);
  return NextResponse.redirect(url);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const adminCanUseEcStudentLookup = pathname === "/ecmember/students";

  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/favicon.ico") ||
    pathname.startsWith("/assets") ||
    pathname.match(/\.(png|jpg|jpeg|gif|svg|webp|css|js|ico)$/)
  ) {
    return NextResponse.next();
  }

  const isLoginRoute = pathname === "/" || pathname === "/login";
  const isActionRoute = pathname === "/auth/action";
  const isChangePasswordRoute = pathname === "/change-password";
  const isVerifyPendingRoute = pathname === "/verify-email-pending";
  const isProtectedDashboard =
    pathname.startsWith("/teacher") ||
    pathname.startsWith("/student") ||
    pathname.startsWith("/ecmember") ||
    pathname.startsWith("/admin");

  if (isLoginRoute || isActionRoute) {
    return NextResponse.next();
  }

  const loggedIn = req.cookies.get("campus_logged_in")?.value === "1";
  const role = req.cookies.get("campus_role")?.value;
  const mustChangePassword = req.cookies.get("campus_must_change")?.value === "1";
  const emailVerificationPending =
    req.cookies.get("campus_email_pending")?.value === "1";

  if ((isChangePasswordRoute || isVerifyPendingRoute || isProtectedDashboard) && !loggedIn) {
    return redirectToLogin(req);
  }

  if (loggedIn) {
    const onboardingRequired = mustChangePassword || emailVerificationPending;
    const isAllowedOnboardingRoute =
      isChangePasswordRoute || isVerifyPendingRoute || isActionRoute;

    if (onboardingRequired && !isAllowedOnboardingRoute) {
      const url = req.nextUrl.clone();
      url.pathname = emailVerificationPending
        ? "/verify-email-pending"
        : "/change-password";
      url.searchParams.set("next", pathname + req.nextUrl.search);
      return NextResponse.redirect(url);
    }

    if (emailVerificationPending && isChangePasswordRoute) {
      const url = req.nextUrl.clone();
      url.pathname = "/verify-email-pending";
      return NextResponse.redirect(url);
    }

    if (!onboardingRequired && (isChangePasswordRoute || isVerifyPendingRoute)) {
      const url = req.nextUrl.clone();
      url.pathname = ROLE_HOME[role ?? ""] ?? "/";
      return NextResponse.redirect(url);
    }
  }

  if (pathname.startsWith("/teacher") && role !== "teacher") {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[role ?? ""] ?? "/";
    return NextResponse.redirect(url);
  }

  if (
    pathname.startsWith("/student") &&
    role !== "student" &&
    role !== "ec" &&
    role !== "ecmember"
  ) {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[role ?? ""] ?? "/";
    return NextResponse.redirect(url);
  }

  if (
    pathname.startsWith("/ecmember") &&
    role !== "ec" &&
    role !== "ecmember" &&
    !(role === "admin" && adminCanUseEcStudentLookup)
  ) {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[role ?? ""] ?? "/";
    return NextResponse.redirect(url);
  }

  if (pathname.startsWith("/admin") && role !== "admin") {
    const url = req.nextUrl.clone();
    url.pathname = ROLE_HOME[role ?? ""] ?? "/";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!api).*)"],
};
