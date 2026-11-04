# Blind-spot catalog

This file is project-customizable: add, remove, or reword items for this project. An edited copy is kept by `update --apply`.
Case design walks every item below for the flows the change affects. The evidence tool reads the item IDs from the table, so a suite must account for each one in `blindSpots`: the cases that apply it, a skip reason, or a question for the human.

## Generators

Apply each generator to the affected flows, not to the whole application:

- **Input:** every changed form field or parameter gets its boundary values: empty, at and past the maximum length, unicode and emoji, zero, negative, the maximum value, and special characters.
- **State:** every changed screen is checked in each state it can reach: loading, empty, error, success, and no permission.
- **Interruption:** every changed flow is interrupted the ways a user interrupts it: reload, back, double click, network loss mid-flow, and two tabs editing the same record.
- **Viewport:** every changed page is opened at the project's mobile viewport, with a screenshot and the layout checks the request implies. When the request is about narrow screens, wrapping, or overflow, also measure at 320 and 360 px wide: a project's mobile device is often wider, and text that fits there can still wrap on smaller phones. Measure wrapping with the `lineCount` helper in `playwright-contract.md`, never by eye.
- **Invariant:** the generic invariants hold in every case the change touches.

An item applies when its generator reaches something the change touched. Skip it with a reason when nothing it covers changed, for example "no form field changed".
When an invariant cannot decide what is right, such as whether long text should truncate or wrap, record a question for the human instead of asserting either answer.

## Catalog

| ID | Generator | What to check |
| --- | --- | --- |
| `input-empty` | input | Empty and whitespace-only values are rejected or handled visibly, and nothing is saved by accident. |
| `input-length` | input | Values at the maximum length are accepted and one past it is refused with a visible message. |
| `input-unicode` | input | Unicode, emoji, accented and right-to-left text survive save, reload, and display without corruption. |
| `input-numeric-bounds` | input | Zero, negative, decimal, and maximum numbers are accepted or refused as the rules say. |
| `input-special` | input | Quotes, angle brackets, `%`, and markup are stored and shown literally, never interpreted. |
| `state-loading` | state | A loading state appears and resolves; it never stays forever. |
| `state-empty` | state | The screen with no data shows an empty state, not a blank area or an error. |
| `state-error` | state | A failed request shows a visible error and the screen stays usable. |
| `state-no-permission` | state | A user without permission sees a refusal, and the action is refused by the server too. |
| `interrupt-double-submit` | interruption | A double click or repeated submit creates one record and one request. |
| `interrupt-reload-back` | interruption | Reload or back mid-flow loses no saved data and leaves no half-saved record. |
| `interrupt-network` | interruption | Going offline mid-flow (`context.setOffline(true)`) shows an error, keeps the user's input, and recovers. |
| `interrupt-two-tabs` | interruption | Two tabs editing the same record do not silently overwrite each other's change. |
| `viewport-mobile` | viewport | Each changed page at the mobile viewport, and at 320 and 360 px when the request is about narrow screens, has no horizontal overflow, no clipped controls, and the line counts the request implies. |
| `keyboard-only` | viewport | Changed controls can be reached and operated with the keyboard alone, with visible focus. |
| `invariant-console` | invariant | No new console errors on the touched pages. Start listening after login, so an error the flow expects, such as a 401 the login page handles, is not counted. |
| `invariant-requests` | invariant | No duplicate or unexpected mutation requests. |
| `invariant-input-kept` | invariant | User input survives a validation or server error. |
| `invariant-errors-visible` | invariant | Every failure the user can cause is shown to the user. |
