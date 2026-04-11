export type ECTone =
  | "blue"
  | "green"
  | "amber"
  | "red"
  | "purple"
  | "slate";

export const ecToneClasses: Record<
  ECTone,
  {
    chip: string;
    badge: string;
    icon: string;
    value: string;
    surface: string;
  }
> = {
  blue: {
    chip: "bg-blue-100 text-blue-700",
    badge: "border-blue-100 bg-blue-50 text-blue-700",
    icon: "bg-blue-100 text-blue-700",
    value: "text-blue-700",
    surface: "bg-blue-50/80",
  },
  green: {
    chip: "bg-emerald-100 text-emerald-700",
    badge: "border-emerald-100 bg-emerald-50 text-emerald-700",
    icon: "bg-emerald-100 text-emerald-700",
    value: "text-emerald-700",
    surface: "bg-emerald-50/80",
  },
  amber: {
    chip: "bg-amber-100 text-amber-700",
    badge: "border-amber-100 bg-amber-50 text-amber-700",
    icon: "bg-amber-100 text-amber-700",
    value: "text-amber-700",
    surface: "bg-amber-50/80",
  },
  red: {
    chip: "bg-rose-100 text-rose-700",
    badge: "border-rose-100 bg-rose-50 text-rose-700",
    icon: "bg-rose-100 text-rose-700",
    value: "text-rose-700",
    surface: "bg-rose-50/80",
  },
  purple: {
    chip: "bg-violet-100 text-violet-700",
    badge: "border-violet-100 bg-violet-50 text-violet-700",
    icon: "bg-violet-100 text-violet-700",
    value: "text-violet-700",
    surface: "bg-violet-50/80",
  },
  slate: {
    chip: "bg-slate-100 text-slate-700",
    badge: "border-slate-200 bg-slate-50 text-slate-700",
    icon: "bg-slate-100 text-slate-700",
    value: "text-slate-700",
    surface: "bg-slate-50/80",
  },
};

export function getECToneClasses(tone: ECTone = "slate") {
  return ecToneClasses[tone];
}
