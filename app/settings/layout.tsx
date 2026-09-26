import { noindexMetadata } from "@/lib/seo";

export const metadata = noindexMetadata("Settings");

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
