// Fixture Difficulty Rating scale — purple theme with green/red difficulty
// bounds, as specified in the brand guidelines. Difficulty is never conveyed
// by color alone: every cell carries the opponent code and a tooltip with the
// numeric FDR and label.

export interface FdrStyle {
  label: string;
  bgLight: string;
  bgDark: string;
  textLight: string;
  textDark: string;
}

export const fdrTheme: Record<number, FdrStyle> = {
  1: {
    label: "Very Easy",
    bgLight: "bg-emerald-500",
    bgDark: "dark:bg-emerald-400",
    textLight: "text-slate-950",
    textDark: "dark:text-slate-950",
  },
  2: {
    label: "Easy",
    bgLight: "bg-emerald-800",
    bgDark: "dark:bg-emerald-900",
    textLight: "text-emerald-100",
    textDark: "dark:text-emerald-200",
  },
  3: {
    label: "Medium",
    bgLight: "bg-purple-900",
    bgDark: "dark:bg-purple-950",
    textLight: "text-purple-200",
    textDark: "dark:text-purple-300",
  },
  4: {
    label: "Hard",
    bgLight: "bg-rose-800",
    bgDark: "dark:bg-rose-900",
    textLight: "text-rose-100",
    textDark: "dark:text-rose-200",
  },
  5: {
    label: "Very Hard",
    bgLight: "bg-red-500",
    bgDark: "dark:bg-red-600",
    textLight: "text-white",
    textDark: "dark:text-white",
  },
};

export const fdrClasses = (fdr: number): string => {
  const t = fdrTheme[fdr] ?? fdrTheme[3];
  return `${t.bgLight} ${t.bgDark} ${t.textLight} ${t.textDark}`;
};

export const fdrLabel = (fdr: number): string => fdrTheme[fdr]?.label ?? "Medium";
