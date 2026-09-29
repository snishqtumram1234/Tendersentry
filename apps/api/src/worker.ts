// BullMQ worker entrypoint (spec §4.4). Queue consumers are added phase by phase; this boots the
// process and confirms Redis connectivity so `docker compose up` has a real container to run.
// eslint-disable-next-line no-console
console.log("TenderSentry worker starting (no queues registered yet — Phase 0 stub).");
setInterval(() => {}, 1 << 30); // keep the process alive
