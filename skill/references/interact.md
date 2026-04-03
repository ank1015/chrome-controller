# Interact With Web Apps

Use this reference together with [api.md](api.md) for signatures and [workflow.md](workflow.md) for the general interaction flow.

## When To Read

Read this reference when the task needs to change page state:

- compose a draft
- fill a form
- click through a workflow
- navigate within an authenticated app
- trigger a reversible user action and verify the outcome

## Core Principle

For most web app interactions, combine:

- `waitForLoad()`
- `waitFor(...)`
- `evaluate(...)`
- explicit verification

This keeps the interaction logic flexible across different websites and DOM frameworks.

## Relevant Helpers

- `tab.waitForLoad()`
- `tab.waitFor(...)`
- `tab.waitForIdle(ms)`
- `tab.evaluate(code, options?)`
- `tab.info()`
- `tab.goto(url)`
- `tab.focus()`

## Interaction Workflow

1. Confirm you are on the expected page and not a login or permission gate.
2. Wait for the exact app-specific readiness signal that matters for the action.
3. Use `evaluate(...)` to mutate the DOM in the smallest way that matches the app.
4. Dispatch the right DOM events when needed.
5. Verify that the app accepted the change.
6. Avoid irreversible submission unless the user explicitly asked for it.

## Common DOM Patterns

### Fill A Standard Or Controlled Input

```ts
await tab.evaluate(
  `(() => {
    const element = document.querySelector('input[name="subject"]');
    if (!(element instanceof HTMLInputElement)) {
      throw new Error('Subject input not found');
    }

    const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value');
    descriptor?.set?.call(element, 'Meeting reminder');
    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
  })()`
);
```

This pattern is more reliable than assigning `element.value = ...` directly on controlled React-style inputs.

### Fill A `contenteditable`

```ts
await tab.evaluate(
  `(() => {
    const editor = document.querySelector('[contenteditable="true"]');
    if (!(editor instanceof HTMLElement)) {
      throw new Error('Editable region not found');
    }

    editor.focus();
    editor.textContent = 'Reminder: we have a meeting tomorrow at 10 am.';
    editor.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      inputType: 'insertText',
      data: 'Reminder: we have a meeting tomorrow at 10 am.',
    }));
  })()`,
  { userGesture: true }
);
```

This matters for editors like Gmail compose bodies and other rich-text fields.

### Click Or Trigger UI State

If you already know the selector, use `evaluate(...)` directly:

```ts
await tab.evaluate(
  `(() => {
    const button = document.querySelector('[data-testid="compose-button"]');
    if (!(button instanceof HTMLElement)) {
      throw new Error('Compose button not found');
    }
    button.click();
  })()`,
  { userGesture: true }
);
```

The selector is usually the hard part. The click itself is not the real abstraction boundary.

## Example: Create A Draft

This is the same shape we used for the Gmail draft task:

1. Open or reuse the mail tab.
2. Wait for the compose surface.
3. Fill the recipient field, subject field, and body with page-specific `evaluate(...)` code.
4. Verify that the draft fields contain the expected values.
5. Stop before sending unless the user explicitly asks to send.

## Verification Tips

- Read values back with another `evaluate(...)` call instead of assuming the UI updated.
- Verify page transitions with `waitFor(...)` when buttons cause navigation or modals.
- If a task asks you to keep the tab open for user verification, close only the helper session and leave the browser tab untouched.
