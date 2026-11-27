import type { Meta, StoryObj } from '@storybook/react';
import { GiftStatusBadge } from './GiftStatusBadge';
import type { GiftStatus } from '@/types';

const meta: Meta<typeof GiftStatusBadge> = {
  title: 'UI/GiftStatusBadge',
  component: GiftStatusBadge,
  tags: ['autodocs'],
  parameters: {
    a11y: {
      config: {
        rules: [
          {
            id: 'color-contrast',
            enabled: true,
          },
        ],
      },
    },
    docs: {
      description: {
        component:
          'Displays a badge representing the current status of a gift. ' +
          'GiftStatusBadge has no disabled or error state — it is a purely presentational ' +
          'component that renders one of a fixed set of status values. ' +
          'Each status maps to a distinct visual style (color and label).',
      },
    },
  },
  argTypes: {
    status: {
      control: 'select',
      options: [
        'draft',
        'pending_payment',
        'funded',
        'locked',
        'unlocked',
        'claimed',
        'expired_pending_refund',
        'expired',
        'cancelled',
      ] satisfies GiftStatus[],
      description: 'The current status of the gift.',
    },
  },
};

export default meta;
type Story = StoryObj<typeof GiftStatusBadge>;

export const Default: Story = {
  args: {
    status: 'draft',
  },
};

export const Draft: Story = {
  args: {
    status: 'draft',
  },
};

export const PendingPayment: Story = {
  args: {
    status: 'pending_payment',
  },
};

export const Funded: Story = {
  args: {
    status: 'funded',
  },
};

export const Locked: Story = {
  args: {
    status: 'locked',
  },
};

export const Unlocked: Story = {
  args: {
    status: 'unlocked',
  },
};

export const Claimed: Story = {
  args: {
    status: 'claimed',
  },
};

export const ExpiredPendingRefund: Story = {
  args: {
    status: 'expired_pending_refund',
  },
};

export const Expired: Story = {
  args: {
    status: 'expired',
  },
};

export const Cancelled: Story = {
  args: {
    status: 'cancelled',
  },
};