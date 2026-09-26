import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("Gameweek review");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
