import Image from "next/image";
import { Skeleton } from "@heroui/skeleton";

export function CampusAuthLogo() {
  return (
    <div className="mb-5 flex w-full items-center justify-center overflow-visible rounded-none border-0 bg-transparent shadow-none">
      <Image
        src="/campus-login logo.png"
        alt="CAMPUS login logo"
        width={720}
        height={280}
        className="h-auto w-full max-w-[300px] object-contain drop-shadow-[0_22px_40px_rgba(123,0,0,0.2)] sm:max-w-[360px] lg:max-w-[400px]"
        priority
      />
    </div>
  );
}

export function CampusAuthLogoSkeleton() {
  return (
    <Skeleton className="mb-5 h-[64px] w-full max-w-[300px] rounded-3xl sm:h-[72px] sm:max-w-[360px] lg:max-w-[400px]" />
  );
}
