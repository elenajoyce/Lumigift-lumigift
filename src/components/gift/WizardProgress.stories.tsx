import type { Meta, StoryObj } from "@storybook/react";
import { WizardProgress } from "./WizardProgress";

/**
 * WizardProgress stories — issue #471
 *
 * Demonstrates all three step states simultaneously:
 *  - Completed steps: checkmark icon, success colour
 *  - Active step:     brand colour, bold label
 *  - Future steps:    muted colour
 */
const meta: Meta<typeof WizardProgress> = {
  title: "Gift/WizardProgress",
  component: WizardProgress,
  tags: ["autodocs"],
  parameters: {
    layout: "padded",
  },
};

export default meta;
type Story = StoryObj<typeof WizardProgress>;

/** Step 0 active — no completed steps yet. */
export const FirstStep: Story = {
  args: { currentStep: 0 },
  name: "First step (active)",
};

/** Step 2 active — steps 0 and 1 completed, steps 3 and 4 future.
 *  This story shows all three states (completed, active, future) at once. */
export const MiddleStep: Story = {
  args: { currentStep: 2 },
  name: "Middle step — all three states visible",
};

/** Last step active — all earlier steps completed. */
export const LastStep: Story = {
  args: { currentStep: 4 },
  name: "Last step (review)",
};
