import { useState, useRef } from "react";
import type { Meta, StoryObj } from "@storybook/react";
import { Dialog } from "./Dialog";
import { Button } from "./Button";

const meta: Meta<typeof Dialog> = {
  title: "UI/Dialog",
  component: Dialog,
  tags: ["autodocs"],
  argTypes: {
    open: { control: "boolean" },
    title: { control: "text" },
  },
};

export default meta;
type Story = StoryObj<typeof Dialog>;

export const Default: Story = {
  render: (args) => {
    const [open, setOpen] = useState(args.open ?? false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
        <Button ref={triggerRef} onClick={() => setOpen(true)}>
          Open dialog
        </Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          title={args.title ?? "Dialog title"}
        >
          <p>This is the dialog content. Press Escape or click the backdrop to close.</p>
          <div style={{ display: "flex", gap: "0.5rem", marginTop: "1rem" }}>
            <Button onClick={() => setOpen(false)} variant="secondary">
              Cancel
            </Button>
            <Button onClick={() => setOpen(false)}>Confirm</Button>
          </div>
        </Dialog>
      </div>
    );
  },
  args: {
    open: false,
    title: "Are you sure?",
  },
};

export const KeyboardNavigation: Story = {
  render: () => {
    const [open, setOpen] = useState(false);
    const triggerRef = useRef<HTMLButtonElement>(null);
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: "1rem", alignItems: "center" }}>
        <p style={{ fontSize: "0.875rem", color: "var(--color-text-secondary)" }}>
          Test keyboard navigation: Tab/Shift+Tab cycles focus, Escape closes, focus returns to
          trigger.
        </p>
        <Button ref={triggerRef} onClick={() => setOpen(true)}>
          Open dialog with keyboard trap
        </Button>
        <Dialog
          open={open}
          onClose={() => setOpen(false)}
          triggerRef={triggerRef}
          title="Keyboard Navigation Demo"
        >
          <div style={{ display: "flex", flexDirection: "column", gap: "0.75rem" }}>
            <label>
              Name:
              <input type="text" style={{ marginLeft: "0.5rem", padding: "0.25rem" }} />
            </label>
            <label>
              Email:
              <input type="email" style={{ marginLeft: "0.5rem", padding: "0.25rem" }} />
            </label>
            <label>
              Message:
              <textarea style={{ marginLeft: "0.5rem", padding: "0.25rem", minHeight: "60px" }} />
            </label>
            <div style={{ display: "flex", gap: "0.5rem", marginTop: "0.5rem" }}>
              <Button onClick={() => setOpen(false)} variant="secondary">
                Cancel
              </Button>
              <Button onClick={() => setOpen(false)}>Submit</Button>
            </div>
          </div>
        </Dialog>
      </div>
    );
  },
  args: {
    open: false,
    title: "Keyboard Navigation Demo",
  },
  parameters: {
    docs: {
      description: {
        story:
          "This story demonstrates the keyboard trap functionality. When the dialog opens:\n" +
          "- Focus moves to the first focusable element (Name input)\n" +
          "- Tab cycles through all focusable elements (inputs, buttons)\n" +
          "- Shift+Tab cycles in reverse\n" +
          "- Pressing Escape closes the dialog\n" +
          "- Focus returns to the trigger button on close",
      },
    },
  },
};
