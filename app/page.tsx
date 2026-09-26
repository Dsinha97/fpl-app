import { routeMetadata, SITE_ROUTES } from "@/lib/seo";
import HomeClient from "./home-client";

// A server wrapper so the home route can export its own metadata — the page
// itself is a client component. The canonical lives here rather than in the
// root layout, where every route without its own layout would inherit "/".
export const metadata = routeMetadata(SITE_ROUTES.home);

export default function Home() {
  return <HomeClient />;
}
