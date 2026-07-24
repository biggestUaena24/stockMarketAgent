import type { Metadata } from "next";
import { ReportsScreen } from "@/app/screens/ReportsScreen";

export const metadata: Metadata = { title: "Report history" };

export default function ReportsPage() {
  return <ReportsScreen />;
}
