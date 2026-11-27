import type { Meta, StoryObj } from "@storybook/react";
import { Input } from "./Input";

const meta: Meta<typeof Input> = {
  title: "UI/Input",
  component: Input,
  tags: ["autodocs"],
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "label", enabled: true },
          { id: "aria-input-field-name", enabled: true },
        ],
      },
    },
  },
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "tel", "number", "password"],
      description: "Input type",
    },
    error: {
      control: "text",
      description: "Validation error message (shows error styling)",
    },
    hint: {
      control: "text",
      description: "Helper text shown below the input",
    },
  },
};

export default meta;
type Story = StoryObj<typeof Input>;

export const Default: Story = {
  args: {
    label: "Email address",
    placeholder: "you@example.com",
    type: "email",
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "label", enabled: true }],
      },
    },
  },
};

export const WithError: Story = {
  args: {
    label: "Email address",
    placeholder: "you@example.com",
    type: "email",
    error: "Please enter a valid email address",
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: "label", enabled: true },
          { id: "aria-input-field-name", enabled: true },
        ],
      },
    },
  },
};

export const WithHint: Story = {
  args: {
    label: "Recipient phone",
    placeholder: "+234 801 234 5678",
    type: "tel",
    hint: "We'll never share your number with third parties",
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "label", enabled: true }],
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    label: "Disabled input",
    placeholder: "Cannot edit",
    disabled: true,
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: "label", enabled: true }],
      },
    },
  },
};