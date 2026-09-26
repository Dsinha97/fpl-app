import { routeMetadata, SITE_ROUTES } from "@/lib/seo";

export const metadata = routeMetadata(SITE_ROUTES.team);

export default function Layout({ children }: { children: React.ReactNode }) {
  return children;
}
