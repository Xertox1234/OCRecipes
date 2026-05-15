# Animation Lab — runnable demo

`AnimationLabScreen.tsx` is a self-contained showcase of the patterns
documented in `../01–09`. It demonstrates ten techniques (press feedback,
success pop, number ticker, shimmer skeleton, staggered list, swipe-to-
dismiss, spring vs timing, layout animation, scroll-driven header, reduce-
motion status) using the project's existing theme tokens, animation
configs, and accessibility hooks.

## What it depends on

Already in the project — no new packages needed:

- `react-native-reanimated ~4.1.1`
- `react-native-gesture-handler ~2.28.0`
- `expo-haptics`
- `@/constants/theme`, `@/constants/animations`
- `@/hooks/useAccessibility`, `@/hooks/useHaptics`, `@/hooks/useSuccessAnimation`

## How to wire it up

The demo lives outside `client/` (under `docs/research/ui-animations/demo/`)
so it doesn't get bundled into your production app by default. Two routes
to running it:

### Option A: Symlink or copy into `client/screens/dev/`

The most "real-app" approach. Put it on a route reachable only in dev.

1. Copy or symlink the file:

   ```bash
   mkdir -p client/screens/dev
   ln -s ../../docs/research/ui-animations/demo/AnimationLabScreen.tsx \
         client/screens/dev/AnimationLabScreen.tsx
   ```

2. Add a route to `client/navigation/RootStackNavigator.tsx`. Find the
   block that registers root-level modal screens (look for
   `presentation: "modal"`) and add:

   ```tsx
   {
     __DEV__ && (
       <Stack.Screen
         name="AnimationLab"
         component={AnimationLabScreen}
         options={{
           presentation: "modal",
           headerTitle: "Animation Lab",
           animation: reducedMotion ? "none" : "slide_from_bottom",
           gestureEnabled: true,
         }}
       />
     );
   }
   ```

   Don't forget the import:

   ```tsx
   import AnimationLabScreen from "@/screens/dev/AnimationLabScreen";
   ```

3. Add the route name to the navigator's TypeScript param list (wherever
   the existing modals are typed):

   ```tsx
   AnimationLab: undefined;
   ```

4. Open the lab from any screen during development:

   ```tsx
   navigation.navigate("AnimationLab");
   ```

   Or wire it to a long-press on the profile avatar, a 5-tap on the version
   number in settings, or any other developer-only affordance you have.

### Option B: Drop straight into App.tsx for quick playback

If you just want to _see it work_ once without touching navigation:

1. Copy the file to `client/AnimationLabScreen.tsx` (so the imports resolve).

2. Replace the root component in `App.tsx` temporarily:

   ```tsx
   import AnimationLabScreen from "./client/AnimationLabScreen";
   import { GestureHandlerRootView } from "react-native-gesture-handler";

   export default function App() {
     return (
       <GestureHandlerRootView style={{ flex: 1 }}>
         <AnimationLabScreen />
       </GestureHandlerRootView>
     );
   }
   ```

3. Run `npx expo run:ios` (or your usual dev command). Don't commit this
   change — it's a temporary preview.

## Test it under Reduce Motion

While the app is open on your phone or simulator:

- **iOS**: Settings → Accessibility → Motion → Reduce Motion → toggle on
- **Simulator**: Hardware → Reduce Motion (or in iOS Settings inside the
  simulator)
- **Android**: Settings → Accessibility → Text and display → Remove
  animations

Every demo should still work — just without the motion. The "Reduce Motion
preview" section at the bottom of the lab screen shows the live status.

## What to play with

The file is meant to be edited. Some quick experiments:

- **Change spring damping/stiffness** in `SpringVsTimingDemo` — try
  `damping: 6` for visible bounce, `damping: 40` for no overshoot.
- **Change the stagger delay** in `StaggeredListDemo` — try `30`, `80`,
  `150` ms to see how the pacing changes.
- **Change the shimmer duration** in `SkeletonBlock` — speed up to 800 ms
  and see how it suddenly feels frantic; slow to 3000 ms and it feels
  asleep.
- **Change `swipeActionThreshold`** in `SwipeToDismissDemo` — try `30`
  for hair-trigger, `150` for "have to mean it."
- **Comment out the haptic calls** to feel the difference between
  visual-only and motion+haptic feedback.
- **Add a new section** — copy the `Section` component pattern and
  prototype your own micro-interaction.

## Removing the demo when you're done

If you wired Option A, just delete the `Stack.Screen` block and the
import. The symlinked file can be left in place; `__DEV__` gates it
from production bundles.

If you wired Option B, revert your `App.tsx` change.
