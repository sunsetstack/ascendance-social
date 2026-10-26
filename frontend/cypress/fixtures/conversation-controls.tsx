import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { CssBaseline, ThemeProvider, createTheme } from "@mui/material";
import { AuthContext } from "../../src/context/Auth/AuthContext";
import Messages from "../../src/screens/Messages";

const client = new QueryClient({
  defaultOptions: { queries: { retry: false } },
});
client.setQueryData(["currentUser"], {
  publicId: "11111111-1111-4111-8111-111111111111",
  handle: "alice",
  username: "Alice",
  isAdmin: new URLSearchParams(window.location.search).get("admin") === "1",
  isEmailVerified: true,
});
createRoot(document.getElementById("root")!).render(
  <QueryClientProvider client={client}>
    <AuthContext.Provider
      value={{
        login: () => undefined,
        logout: async () => undefined,
        error: null,
      }}
    >
      <ThemeProvider theme={createTheme()}>
        <CssBaseline />
        <BrowserRouter>
          <Messages />
        </BrowserRouter>
      </ThemeProvider>
    </AuthContext.Provider>
  </QueryClientProvider>,
);
