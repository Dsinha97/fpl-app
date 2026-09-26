import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("Compare players");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
