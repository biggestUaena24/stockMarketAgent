import type { Metadata } from "next";
import { DashboardScreen } from "@/app/screens/DashboardScreen";

export const metadata: Metadata = { title: "Overview" };

export default function DashboardPage() {
  return <DashboardScreen />;
}
