import React, { createContext, useContext, ReactNode } from "react";
import { useAuth } from "@/hooks/useAuth";

interface User {
  id: string;
  username: string;
  displayName?: string;
  dailyCalorieGoal?: number;
  onboardingCompleted?: boolean;
}

interface AuthContextType {
  user: User | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  login: (username: string, password: string) => Promise<User>;
  register: (username: string, password: string) => Promise<User>;
  logout: () => Promise<void>;
  updateUser: (updates: Partial<User>) => Promise<User | undefined>;
  checkAuth: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const auth = useAuth();

  return <AuthContext.Provider value={auth}>{children}</AuthContext.Provider>;
}

export function useAuthContext() {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuthContext must be used within an AuthProvider");
  }
  return context;
}
