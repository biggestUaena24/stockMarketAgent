import type { Metadata } from "next";
import { ImportScreen } from "@/app/screens/ImportScreen";

export const metadata: Metadata = { title: "Import & reconcile" };

export default function ImportPage() {
  return <ImportScreen />;
}
