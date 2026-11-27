import type { Meta, StoryObj } from '@storybook/react';
import { ConfirmationSafetyNotice } from './ConfirmationSafetyNotice';

const meta: Meta<typeof ConfirmationSafetyNotice> = {
  title: 'UI/ConfirmationSafetyNotice',
  component: ConfirmationSafetyNotice,
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [
          {
            id: 'aria-allowed-attr',
            enabled: true,
          },
          {
            id: 'aria-valid-attr-value',
            enabled: true,
          },
        ],
      },
    },
  },
  tags: ['autodocs'],
  argTypes: {
    type: {
      control: 'select',
      options: ['payment', 'claim'],
      description: 'The type of confirmation being displayed',
    },
    amount: {
      control: 'text',
      description: 'Optional amount to display in the notice',
    },
    isTestnet: {
      control: 'boolean',
      description: 'Whether the notice is shown on testnet',
    },
  },
};

export default meta;
type Story = StoryObj<typeof ConfirmationSafetyNotice>;

export const Default: Story = {
  args: {
    type: 'payment',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'aria-allowed-attr',
            enabled: true,
          },
          {
            id: 'aria-valid-attr-value',
            enabled: true,
          },
        ],
      },
    },
  },
};

export const ClaimType: Story = {
  args: {
    type: 'claim',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'aria-allowed-attr',
            enabled: true,
          },
          {
            id: 'aria-valid-attr-value',
            enabled: true,
          },
        ],
      },
    },
  },
};

export const WithAmount: Story = {
  args: {
    type: 'payment',
    amount: '100 XLM',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'aria-allowed-attr',
            enabled: true,
          },
          {
            id: 'aria-valid-attr-value',
            enabled: true,
          },
        ],
      },
    },
  },
};

export const Testnet: Story = {
  args: {
    type: 'payment',
    isTestnet: true,
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'aria-allowed-attr',
            enabled: true,
          },
          {
            id: 'aria-valid-attr-value',
            enabled: true,
          },
        ],
      },
    },
  },
};