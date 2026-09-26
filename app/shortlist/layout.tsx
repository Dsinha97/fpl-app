import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("Shortlist");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
