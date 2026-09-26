import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("What Changed?");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
