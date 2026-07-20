# Plan: Implement Category Chart Visualization

## Context
The user wants to add a visual representation of spending by category (e.g., Food, Transport, Entertainment) as part of the "Category" feature we just implemented. This will help users see at a glance where their money is going.

## Goals
- Add a doughnut chart to represent the distribution of expenses across different categories.
- Ensure the chart updates automatically when new data is fetched or added.
- Maintain the existing UI aesthetic and theme support.

## Proposed Approach
1.  **Integrate Chart.js**: Include the library in `index.html` (already done via CDN, but need to ensure it's initialized).
2.  **Update `app.js`**:
    *   Create a function `updateChart(data)` that processes the raw data from the server.
    *   The logic will aggregate totals for each unique category found in the dataset.
    *   Implement a check to see if the chart instance already exists; if so, update its data instead of creating a new one (to prevent memory leaks and UI glitches).
3.  **Integrate with existing flows**: Call `updateChart(data)` inside `fetchHistory()` and after a successful `submitExpense` call.

## Key Files
- `index.html`: Contains the `<canvas>` element for the chart.
- `app.js`: Contains the logic to process data and manage the Chart.js instance.

## Verification Plan
1.  **Manual Check**: Verify that adding a new expense with a specific category updates both the list and the chart immediately.
2.  **Visual Test**: Ensure the chart colors and labels match the theme (if applicable) and are clearly legible.
3.  **Data Integrity**: Confirm that the "Total" in the dashboard remains consistent with the sum of the parts shown in the chart.
