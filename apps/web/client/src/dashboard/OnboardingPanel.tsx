import { onboardingSteps } from "./constants.js";

type OnboardingPanelProps = {
    onDismiss: () => void;
};

export const OnboardingPanel = ({ onDismiss }: OnboardingPanelProps) => (
    <section className="onboarding-panel">
        <div>
            <h3>Setup checklist</h3>
            <p>{onboardingSteps.length} steps for first-time guild setup</p>
        </div>
        <button type="button" className="secondary" onClick={onDismiss}>
            Dismiss
        </button>
    </section>
);
