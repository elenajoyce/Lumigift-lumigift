import type { Meta, StoryObj } from '@storybook/react';
import { useState } from 'react';
import { DateTimeInput } from './DateTimeInput';

const meta: Meta<typeof DateTimeInput> = {
  title: 'UI/DateTimeInput',
  component: DateTimeInput,
  tags: ['autodocs'],
  parameters: {
    layout: 'centered',
    a11y: {
      config: {
        rules: [
          { id: 'label', enabled: true },
          { id: 'aria-valid-attr-value', enabled: true },
        ],
      },
    },
  },
  argTypes: {
    disabled: { control: 'boolean' },
    error: { control: 'text' },
    hint: { control: 'text' },
    label: { control: 'text' },
  },
};

export default meta;

type Story = StoryObj<typeof DateTimeInput>;

const ControlledDateTimeInput = (props: React.ComponentProps<typeof DateTimeInput>) => {
  const [value, setValue] = useState<string>(props.value ?? '');
  return <DateTimeInput {...props} value={value} onChange={setValue} />;
};

export const Default: Story = {
  render: (args) => <ControlledDateTimeInput {...args} />,
  args: {
    label: 'Event date and time',
    id: 'datetime-default',
    value: '',
    disabled: false,
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'label', enabled: true },
          { id: 'aria-describedby', enabled: true },
        ],
      },
    },
  },
};

export const Disabled: Story = {
  render: (args) => <ControlledDateTimeInput {...args} />,
  args: {
    label: 'Event date and time',
    id: 'datetime-disabled',
    value: '2024-06-15T14:30',
    disabled: true,
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'label', enabled: true },
          { id: 'aria-disabled', enabled: true },
        ],
      },
    },
  },
};

export const Error: Story = {
  render: (args) => <ControlledDateTimeInput {...args} />,
  args: {
    label: 'Event date and time',
    id: 'datetime-error',
    value: '',
    error: 'Please select a valid date and time.',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'label', enabled: true },
          { id: 'aria-describedby', enabled: true },
          { id: 'aria-invalid', enabled: true },
        ],
      },
    },
  },
};

export const WithHint: Story = {
  render: (args) => <ControlledDateTimeInput {...args} />,
  args: {
    label: 'Event date and time',
    id: 'datetime-hint',
    value: '',
    hint: 'Times are shown in your local timezone.',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'label', enabled: true },
          { id: 'aria-describedby', enabled: true },
        ],
      },
    },
  },
};

export const DSTAmbiguity: Story = {
  render: (args) => <ControlledDateTimeInput {...args} />,
  args: {
    label: 'Event date and time',
    id: 'datetime-dst',
    value: '2024-11-03T01:30',
    hint: 'This time occurs twice on the day daylight saving time ends. Please confirm the intended offset.',
    error: 'Ambiguous local time: 01:30 occurs twice on 2024-11-03.',
  },
  parameters: {
    a11y: {
      config: {
        rules: [
          { id: 'label', enabled: true },
          { id: 'aria-describedby', enabled: true },
          { id: 'aria-invalid', enabled: true },
        ],
      },
    },
  },
};