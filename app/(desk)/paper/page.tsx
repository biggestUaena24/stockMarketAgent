import type { Metadata } from "next";
import { PaperScreen } from "@/app/screens/PaperScreen";

export const metadata: Metadata = { title: "Paper performance" };

export default function PaperPage() {
  return <PaperScreen />;
}
