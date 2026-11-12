import { createContext, useContext } from "react";

export const EmailContext = createContext<{ email: string; setEmail: (e: string) => void }>({
  email: "",
  setEmail: () => {},
});

export function useEmail() {
  return useContext(EmailContext);
}
