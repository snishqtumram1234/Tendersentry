import { createApp } from "./app.js";
import { config } from "./config.js";
import { ensureVerificationSourcesSeeded } from "./modules/verification/sources.js";

const app = createApp();

ensureVerificationSourcesSeeded().catch((err) => {
  console.error("Failed to seed verification sources:", err);
});

app.listen(config.API_PORT, () => {
  // eslint-disable-next-line no-console
  console.log(`TenderSentry API listening on :${config.API_PORT} (${config.APP_ENV})`);
});
