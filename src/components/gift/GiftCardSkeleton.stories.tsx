import type { Meta, StoryObj } from "@storybook/react";
import { GiftCardSkeleton } from "./GiftCardSkeleton";

const meta: Meta<typeof GiftCardSkeleton> = {
  title: "Gift/GiftCardSkeleton",
  component: GiftCardSkeleton,
  tags: ["autodocs"],
  argTypes: {
    count: { control: { type: "number", min: 1, max: 20 } },
  },
};

export default meta;
type Story = StoryObj<typeof GiftCardSkeleton>;

export const Default: Story = {
  args: {
    count: 10,
  },
  parameters: {
    docs: {
      description: {
        story:
          "Default skeleton loader matching the dashboard page size (10 cards). " +
          "Uses pulse animation from design system tokens. " +
          "Respects prefers-reduced-motion.",
      },
    },
  },
};

export const SingleCard: Story = {
  args: {
    count: 1,
  },
};

export const ThreeCards: Story = {
  args: {
    count: 3,
  },
};
