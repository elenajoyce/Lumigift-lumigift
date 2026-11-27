import type { Meta, StoryObj } from '@storybook/react';
import { Textarea } from './Textarea';

const meta: Meta<typeof Textarea> = {
  title: 'UI/Textarea',
  component: Textarea,
  tags: ['autodocs'],
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'label', enabled: true }],
      },
    },
  },
  argTypes: {
    disabled: { control: 'boolean' },
    error: { control: 'boolean' },
    placeholder: { control: 'text' },
    label: { control: 'text' },
    hint: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<typeof Textarea>;

export const Default: Story = {
  args: {
    label: 'Message',
    placeholder: 'Enter your message',
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'label', enabled: true }],
      },
    },
  },
};

export const Disabled: Story = {
  args: {
    label: 'Message',
    placeholder: 'Enter your message',
    disabled: true,
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'label', enabled: true }],
      },
    },
  },
};

export const Error: Story = {
  args: {
    label: 'Message',
    placeholder: 'Enter your message',
    error: true,
    hint: 'This field is required',
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'label', enabled: true }],
      },
    },
  },
};

export const WithHint: Story = {
  args: {
    label: 'Message',
    placeholder: 'Enter your message',
    hint: 'Maximum 500 characters',
  },
  parameters: {
    a11y: {
      config: {
        rules: [{ id: 'label', enabled: true }],
      },
    },
  },
};