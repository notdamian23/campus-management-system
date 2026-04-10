import type { ReactNode } from "react";
import Image from "next/image";
import clsx from "clsx";
import { Poppins } from "next/font/google";
import { Card, CardBody } from "@heroui/card";
import { Chip } from "@heroui/chip";
import { Skeleton } from "@heroui/skeleton";

const poppins = Poppins({
  subsets: ["latin"],
  weight: ["400", "600", "700", "800"],
});

type CampusAuthShellProps = {
  title: string;
  description: string;
  children: ReactNode;
  footer?: ReactNode;
  eyebrow?: string;
  className?: string;
  cardClassName?: string;
  bodyClassName?: string;
};

export function CampusAuthShell({
  title,
  description,
  children,
  footer,
  eyebrow,
  className,
  cardClassName,
  bodyClassName,
}: CampusAuthShellProps) {
  return (
    <div
      className={clsx(
        "flex min-h-screen w-full items-center justify-center bg-[radial-gradient(circle_at_top,_#f39b52_0%,_#b72020_38%,_#7b0000_78%)] px-4 py-8 sm:px-6 lg:px-8",
        className,
      )}
    >
      <Card
        shadow="lg"
        className={clsx(
          "w-full max-w-[560px] border border-white/10 bg-bg-main/95 backdrop-blur",
          cardClassName,
        )}
      >
        <CardBody
          className={clsx(
            "flex flex-col items-center px-8 py-10 sm:px-12 sm:py-14",
            bodyClassName,
          )}
        >
          <div className="mb-6 flex h-32 w-32 items-center justify-center overflow-hidden rounded-full border-4 border-white/90 shadow-2xl sm:h-40 sm:w-40">
            <Image
              src="/new campus-logo.jpg"
              alt="Campus Logo"
              width={220}
              height={220}
              className="h-full w-full object-cover"
              priority
            />
          </div>

          {eyebrow ? (
            <Chip
              color="warning"
              variant="flat"
              className="mb-4 border border-warning/20 bg-warning/10 font-semibold text-warning-700"
            >
              {eyebrow}
            </Chip>
          ) : null}

          <h1
            className={clsx(
              "text-center text-5xl font-extrabold tracking-tight text-primary-500 sm:text-6xl",
              poppins.className,
            )}
          >
            {title}
          </h1>

          <p className="mb-8 mt-3 max-w-md text-center text-sm text-campus-text-secondary sm:text-base">
            {description}
          </p>

          <div className="w-full">{children}</div>

          {footer ? (
            <div className="mt-8 text-center text-sm text-campus-text-secondary">
              {footer}
            </div>
          ) : null}
        </CardBody>
      </Card>
    </div>
  );
}

export function CampusAuthShellSkeleton() {
  return (
    <div className="flex min-h-screen w-full items-center justify-center bg-[radial-gradient(circle_at_top,_#f39b52_0%,_#b72020_38%,_#7b0000_78%)] px-4 py-8 sm:px-6 lg:px-8">
      <Card
        shadow="lg"
        className="w-full max-w-[560px] border border-white/10 bg-bg-main/95 backdrop-blur"
      >
        <CardBody className="flex flex-col items-center px-8 py-10 sm:px-12 sm:py-14">
          <Skeleton className="mb-6 h-32 w-32 rounded-full sm:h-40 sm:w-40" />
          <Skeleton className="mb-4 h-8 w-32 rounded-full" />
          <Skeleton className="h-14 w-52 rounded-2xl" />
          <Skeleton className="mt-3 h-5 w-72 rounded-xl" />
          <div className="mt-8 w-full space-y-6">
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-16 w-full rounded-2xl" />
            <Skeleton className="h-14 w-full rounded-2xl" />
          </div>
        </CardBody>
      </Card>
    </div>
  );
}
