import { createNavigationContainerRef } from "@react-navigation/native";

import type { RootStackParamList } from "./RootStackNavigator";

export const navigationRef = createNavigationContainerRef<RootStackParamList>();
