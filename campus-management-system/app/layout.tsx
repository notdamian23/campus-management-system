import type { Metadata } from "next";
import type { ReactNode } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import { HeroUIProvider } from "@heroui/system";
import { ToastProvider } from "@heroui/toast";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "CAMPUS Management System",
  description:
    "Campus attendance, payments, events, and document management system.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: ReactNode;
}>) {
  return (
    <html lang="en">
      <head>
        <link
          href="https://fonts.googleapis.com/icon?family=Material+Icons"
          rel="stylesheet"
        />
      </head>

      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <HeroUIProvider>
          <ToastProvider
            maxVisibleToasts={4}
            placement="top-right"
            toastOffset={60}
            toastProps={{
              variant: "flat",
              radius: "md",
              shouldShowTimeoutProgress: true,
              classNames: {
                base: "border border-border bg-white/95 shadow-lg backdrop-blur",
                title: "font-semibold text-campus-text-primary",
                description: "text-campus-text-secondary",
                closeButton: "text-campus-text-secondary",
              },
            }}
          />
          {children}
        </HeroUIProvider>
      </body>
    </html>
  );
}
