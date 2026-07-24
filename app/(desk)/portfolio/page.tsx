import type { Metadata } from "next";
import { PortfolioScreen } from "@/app/screens/PortfolioScreen";

export const metadata: Metadata = { title: "Portfolio ledger" };

export default function PortfolioPage() {
  return <PortfolioScreen />;
}
