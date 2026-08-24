export type RequiredSetupInput = {
  onboardingComplete: boolean;
  providerMode: "trial" | "full";
  alphaVantageConfigured: boolean;
  fmpConfigured: boolean;
  schedulerSecretConfigured: boolean;
};

export function requiredResearchSetupReady(
  input: RequiredSetupInput,
): boolean {
  const providerConfigured =
    input.providerMode === "full"
      ? input.fmpConfigured
      : input.alphaVantageConfigured;

  return (
    input.onboardingComplete &&
    providerConfigured &&
    input.schedulerSecretConfigured
  );
}
