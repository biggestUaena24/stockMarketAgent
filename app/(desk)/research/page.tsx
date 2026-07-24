import type { Metadata } from "next";
import { ResearchScreen } from "@/app/screens/ResearchScreen";

export const metadata: Metadata = { title: "Company research" };

export default function ResearchPage() {
  return <ResearchScreen />;
}
