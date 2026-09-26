import { defineConfig } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

// Both configs already ignore .next/, out/, build/ and next-env.d.ts.
export default defineConfig([...nextVitals, ...nextTs]);
