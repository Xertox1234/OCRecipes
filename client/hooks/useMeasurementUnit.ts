import { useAuthContext } from "@/context/AuthContext";
import {
  DEFAULT_MEASUREMENT_UNIT,
  type MeasurementUnit,
} from "@shared/lib/units";

/**
 * The authenticated user's preferred measurement unit for body weight/height.
 * Falls back to the default (`metric`) when the user or preference is absent.
 */
export function useMeasurementUnit(): MeasurementUnit {
  const { user } = useAuthContext();
  return user?.measurementUnit ?? DEFAULT_MEASUREMENT_UNIT;
}
