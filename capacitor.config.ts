import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "com.moroizq470829.dayplanner",
  appName: "DayPlanner",
  webDir: "app-shell",
  server: {
    url: "https://resilient-planner.onrender.com/login?native_app=1",
    cleartext: false,
    androidScheme: "https",
    allowNavigation: ["resilient-planner.onrender.com"]
  },
  android: {
    allowMixedContent: false
  }
};

export default config;
