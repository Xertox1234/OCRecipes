---
title: "The iOS date picker keeps the UTC time of day when you pick another day — a date held at local midnight lands on the PREVIOUS day across a DST change; hold picked days at local noon"
track: bug
category: logic-errors
tags: [react-native, date, timezone, dst, date-picker, testing]
module: client
applies_to: [client/screens/meal-plan/GroceryListsScreen.tsx, client/**/*.tsx]
symptoms: ["Picking a day in the iOS calendar shows the day before, but only for some days", "The wrong day appears only when the picked day is on the other side of a daylight-saving change from the current value", "Picking the same day again, once the current value is past the clock change, gives the right day", "All unit tests pass because the picker mock returns dates the test built itself"]
created: '2026-10-26'
severity: medium
---

# The iOS date picker keeps the UTC time of day when you pick another day — hold picked days at local noon

## Problem

The grocery list date fields (#1579) first held each date at **local midnight**. In America/Denver, with the start date on Mon Oct 26 (MDT), tapping Thu Nov 5 in the inline iOS calendar (`@react-native-community/datetimepicker` 9.1.0, `display="inline"`) set the field to **Wed, Nov 4**. US daylight saving time ends on Sun Nov 1, 2026.

## Symptoms

- The shown day is one day early, but only when the picked day is across a DST change from the picker's current `value`.
- With the start already on Nov 4 (after the change), the same Nov 5 tap gave Nov 5. That is the control that confirmed the cause.
- Vitest was green: the picker mock returned dates the test made itself, already at local midnight, so the native behaviour never showed up.

## Root Cause

When the day changes, `UIDatePicker` in date mode keeps the time of day of its current value, as an absolute (UTC) offset, not as a local wall-clock time. In the measured case:

- Local midnight on Oct 26 MDT is 06:00 UTC.
- Picking Nov 5 returns Nov 5 06:00 UTC, which is **23:00 MST on Nov 4**.
- Rounding down to the start of the local day gives Nov 4.

Midnight sits on the edge of the day, so a one-hour DST shift moves it into the previous day. On the spring-forward side the error goes the other way: the value lands at 01:00 on the same day, which hides the bug.

## Solution

Hold every picked calendar day at **local noon**:

- Do this for the defaults, the iOS `onValueChange` result and `DateTimePickerAndroid.open`'s result.
- Convert to `YYYY-MM-DD` with `toLocalDateString` only when building the request.
- A ±1 h DST shift moves noon to 11:00 or 13:00, which is still the same day, so day comparisons (`picked > endDate`) stay correct.

```ts
function localNoon(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 12);
}
```

## Prevention

- Test with the zone pinned (`process.env.TZ = "America/Denver"`, restored in `afterEach`).
- Have the picker mock **derive** its return value from the `value` it was handed, the way iOS does: same UTC time of day, new calendar day. A literal return such as `Date.UTC(2026, 10, 5, 18)` passes under both a midnight and a noon anchor, so it can never fail. Only the derived version is red under the midnight anchor.
- Check one date picker change in the simulator across a DST boundary. The jsdom mock cannot reproduce native time-of-day handling.

## Related Files

- `client/screens/meal-plan/GroceryListsScreen.tsx`: the noon-anchor helper and the date fields.
- `client/screens/meal-plan/__tests__/GroceryListsScreen.test.tsx`: the DST-crossing test with a derived mock return.

## See Also

- [a-date-cannot-express-a-calendar-day](a-date-cannot-express-a-calendar-day-2026-08-31.md): the server-side sibling, where `new Date("yyyy-mm-dd")` is UTC midnight.
