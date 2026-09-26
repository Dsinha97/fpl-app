import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("Signing in");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
