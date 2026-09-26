import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("Pipeline status");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
