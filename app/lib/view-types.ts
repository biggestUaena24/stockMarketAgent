import type { PortfolioView } from "@/lib/portfolio-view";
import type {
  RecommendationView,
  ResearchRunView,
} from "@/lib/reports";
import type { OwnerSettings } from "@/lib/settings";
import type { TransactionRecord } from "@/lib/transactions";

export type ConfigurationState = {
  alphaVantage: boolean;
  fmp: boolean;
  openai: boolean;
  resend: boolean;
  notificationEmail: boolean;
  schedulerSecret: boolean;
};

export type DashboardPayload = {
  settings: OwnerSettings;
  portfolio: PortfolioView;
  reports: ResearchRunView[];
  schedule: {
    timeZone: string;
    nextRuns: Array<{
      slot: "morning" | "evening";
      label: string;
      at: string;
    }>;
  };
  configuration: ConfigurationState;
};

export type TransactionsPayload = {
  transactions: TransactionRecord[];
};

export type ReportsPayload = {
  reports: ResearchRunView[];
};

export type ResearchPayload = {
  research: RecommendationView;
};
